// 외식 AI 분석 프록시 (Vercel 서버리스 함수)
// - 프론트엔드(index.html)가 POST /api/analyze 로 { text } 를 보냄
// - 이 함수가 서버 환경변수 GEMINI_API_KEY 로 Gemini 를 호출
// - API 키는 절대 브라우저로 내려가지 않음 (소스/응답 어디에도 노출 안 됨)

// 기본 모델 → 서버 혼잡(503) 시 예비 모델로 자동 전환
const MODELS = ["gemini-3.5-flash", "gemini-3.1-flash-lite"];

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

const SYSTEM = [
  "당신은 한국 음식 영양 분석가입니다. 사용자가 먹은 음식 설명을 읽고, '실제로 입에 들어간 것' 기준으로 구성 요소별 칼로리를 추정합니다.",
  "다이어트 관리가 목적이므로 과소 집계를 피해 보수적으로(넉넉하게 높은 쪽) 추정합니다.",
  "",
  "[규칙 1 — 구성물 중복 계산 금지 (가장 중요)]",
  "사용자가 언급한 재료가 어떤 요리 '안에 들어있는' 구성물이면(예: 국밥 속 순대, 찌개 속 고기, 김밥 속 계란), 그 재료는 요리 칼로리에 포함해서 계산하고 절대 별도 항목으로 중복 추가하지 마세요.",
  "재료 언급은 대부분 '이 요리에 무엇이 들었는지 설명'하는 것이지 '그걸 추가로 더 먹었다'는 뜻이 아닙니다.",
  "'따로', '추가로', '별도로', '하나 더' 같은 표현이 있을 때만 별도 항목으로 계산하세요.",
  "",
  "[규칙 2 — 먹은 양 반영]",
  "'밥은 반공기만', '반만 먹음', '조금 남김', '3분의 1만' 같은 양 표현이 있으면 해당 부분의 칼로리를 그 비율로 줄여 계산하세요.",
  "",
  "[예시 — 이대로 따라 하세요]",
  "입력: '순대국밥 1그릇 먹었는데 순대 4개 들어있었어. 밥은 반공기만 말아서 먹었어'",
  "올바른 분석: items = [ {\"name\":\"순대국밥 국물+건더기(순대 4개 포함)\",\"kcal\":520}, {\"name\":\"공기밥 반 공기(말아먹음)\",\"kcal\":165} ], total = 685",
  "→ 순대는 국밥 안의 구성물이므로 국밥 칼로리에 포함시키고 별도 항목으로 만들지 않았으며, 밥은 반공기 비율로 줄였습니다.",
  "잘못된 분석(절대 금지): '순대국밥 700 + 순대 4개 200 + 공기밥 반 165' 처럼 안에 든 재료를 중복으로 더하는 것.",
  "",
  "[사진이 있을 때]",
  "사진 속 음식을 알아보고 위 규칙대로 구성 요소별 칼로리를 추정하세요. 사진만으로는 양과 안 보이는 재료(기름·설탕·소스)를 정확히 알기 어려우니, 흔한 1인분 기준으로 넉넉하게 잡되 note에 '사진 기준 추정이라 실제 양에 맞게 조절하세요'라고 안내하세요. 추가 설명(메모)이 함께 오면 그 정보(양·재료)를 우선 반영하세요. 음식이 아닌 사진이면 items를 비우고 note에 '음식 사진이 아닌 것 같습니다'라고 적으세요.",
  "",
  "[출력 형식]",
  "items에는 실제 먹은 것 기준 구성 요소를 담고, 항목 이름 괄호에 포함물/양 조정 내용을 표기하세요. total은 items 합계입니다.",
  "note에는 어떤 가정으로 추정했는지 한국어 한두 문장으로 적으세요(예: '순대는 국밥에 포함해 계산했습니다'). kcal은 정수입니다."
].join("\n");

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
  const image = (body && body.image) ? body.image : null;   // { mimeType, data(base64) }
  if (!text && !image) { res.status(400).json({ error: "음식 설명이나 사진을 넣어 주세요." }); return; }
  if (text.length > 500) { res.status(400).json({ error: "입력이 너무 깁니다. 짧게 적어주세요." }); return; }
  if (image && (!image.data || typeof image.data !== "string" || image.data.length > 8000000)) {
    res.status(400).json({ error: "사진을 처리할 수 없습니다. 다른 사진으로 시도해 주세요." }); return;
  }

  // Gemini에 보낼 parts 구성 (사진 있으면 이미지 + 안내문, 텍스트 메모도 함께)
  const parts = [];
  if (image) {
    parts.push({ inline_data: { mime_type: image.mimeType || "image/jpeg", data: image.data } });
    parts.push({ text: "이 사진 속 음식을 분석해줘." + (text ? (" 추가 설명: " + text) : "") });
  } else {
    parts.push({ text: "다음을 분석해줘: " + text });
  }

  try {
    const reqBody = JSON.stringify({
      system_instruction: { parts: [{ text: SYSTEM }] },
      contents: [{ role: "user", parts: parts }],
      generationConfig: { responseMimeType: "application/json", responseSchema: SCHEMA, temperature: 0.4 }
    });

    let r = null, data = null;
    for (let i = 0; i < MODELS.length; i++) {
      const model = MODELS[i];
      const url = "https://generativelanguage.googleapis.com/v1beta/models/" +
        model + ":generateContent?key=" + encodeURIComponent(key);
      r = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: reqBody
      });
      data = await r.json().catch(() => ({}));
      if (r.ok) break;

      const detail = (data.error && data.error.message) ? data.error.message : ("HTTP " + r.status);
      console.error("Gemini 오류(" + model + "):", r.status, detail);

      // 서버 혼잡/일시 장애면 예비 모델로 한 번 더 시도
      if ((r.status === 503 || r.status === 500) && i < MODELS.length - 1) continue;

      if (r.status === 429) {
        res.status(429).json({ error: "지금 사용량이 많습니다. 잠시 후 다시 시도해 주세요." });
      } else if (r.status === 503 || r.status === 500) {
        res.status(503).json({ error: "AI 서버가 혼잡합니다. 잠시 후 다시 시도해 주세요." });
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

    const respParts = (data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts) || [];
    const txt = respParts.map(function (p) { return p.text || ""; }).join("");
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
