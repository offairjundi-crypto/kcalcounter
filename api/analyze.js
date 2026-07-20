// 외식 AI 분석 프록시 (Vercel 서버리스 함수)
// - 프론트엔드(index.html)가 POST /api/analyze 로 { text } 를 보냄
// - 이 함수가 서버 환경변수 GEMINI_API_KEY 로 Gemini 를 호출
// - API 키는 절대 브라우저로 내려가지 않음 (소스/응답 어디에도 노출 안 됨)

const MODEL = "gemini-3.5-flash"; // 무료 최신 Flash. 바꾸려면 이 값만 수정.

const SCHEMA = {
  type: "OBJECT",
  properties: {
    items: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: { name: { type: "STRING" }, kcal: { type: "INTEGER" } },
        required: ["name", "kcal"]
      }
    },
    total: { type: "INTEGER" },
    note: { type: "STRING" }
  },
  required: ["items", "total", "note"]
};

const SYSTEM =
  "당신은 한국 음식 영양 분석가입니다. 사용자가 먹은 외식/음식을 구성 요소별로 나누고, 각 항목의 1인분 기준 칼로리를 추정하세요. " +
  "다이어트 관리가 목적이므로 과소 집계를 피해 '보수적으로(넉넉하게 높은 쪽)' 추정합니다. " +
  "items에는 구성 요소를 담고(예: 공기밥 330, 김치찌개 350), total은 items 합계, note에는 추정 근거나 주의점을 한국어 한두 문장으로 씁니다. kcal은 정수입니다.";

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ error: "POST만 허용됩니다." });
    return;
  }

  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    console.error("GEMINI_API_KEY 환경변수가 설정되지 않았습니다.");
    res.status(500).json({ error: "서버 설정 오류입니다. 관리자에게 문의하세요." });
    return;
  }

  // 본문 파싱 (Vercel은 application/json을 자동 파싱하지만 방어적으로 처리)
  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  const text = (body && body.text ? String(body.text) : "").trim();
  if (!text) { res.status(400).json({ error: "먹은 음식을 입력해 주세요." }); return; }
  if (text.length > 500) { res.status(400).json({ error: "입력이 너무 깁니다. 짧게 적어주세요." }); return; }

  try {
    const url = "https://generativelanguage.googleapis.com/v1beta/models/" +
      MODEL + ":generateContent?key=" + encodeURIComponent(key);
    const r = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: SYSTEM }] },
        contents: [{ role: "user", parts: [{ text: "다음을 분석해줘: " + text }] }],
        generationConfig: { responseMimeType: "application/json", responseSchema: SCHEMA, temperature: 0.4 }
      })
    });

    const data = await r.json().catch(() => ({}));

    if (!r.ok) {
      const detail = (data.error && data.error.message) ? data.error.message : ("HTTP " + r.status);
      console.error("Gemini 오류:", r.status, detail);
      if (r.status === 429) {
        res.status(429).json({ error: "지금 사용량이 많습니다. 잠시 후 다시 시도해 주세요." });
      } else {
        // 내부 오류 상세(키 관련 등)는 사용자에게 노출하지 않음
        res.status(502).json({ error: "분석에 실패했습니다. 잠시 후 다시 시도해 주세요." });
      }
      return;
    }

    if (data.promptFeedback && data.promptFeedback.blockReason) {
      res.status(200).json({ error: "분석이 차단됐습니다. 다른 표현으로 다시 시도해 주세요." });
      return;
    }

    const parts = (data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts) || [];
    const txt = parts.map(function (p) { return p.text || ""; }).join("");
    let parsed;
    try { parsed = JSON.parse(txt); }
    catch (e) { res.status(502).json({ error: "응답을 해석하지 못했습니다. 다시 시도해 주세요." }); return; }

    res.status(200).json({
      items: Array.isArray(parsed.items) ? parsed.items : [],
      total: Number(parsed.total) || 0,
      note: typeof parsed.note === "string" ? parsed.note : ""
    });
  } catch (err) {
    console.error("프록시 예외:", err);
    res.status(502).json({ error: "분석 서버 호출에 실패했습니다." });
  }
};
