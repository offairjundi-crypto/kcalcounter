# 칼로리 추적기 — 배포 가이드

프론트엔드(정적 HTML) + 서버 함수(프록시) 구조.
**API 키는 서버 환경변수로만 두고, 소스코드/브라우저 어디에도 넣지 않습니다.** 사용자는 키 입력 없이 그냥 씁니다.

```
배포/
  index.html          ← 프론트엔드 (키 없음)
  api/analyze.js       ← 서버 함수: 환경변수 GEMINI_API_KEY 로 Gemini 호출
  README-배포.md       ← 이 문서
```

---

## A. Vercel로 배포 (권장 · 이 폴더 구조 그대로 됨)

### 1) Gemini API 키 준비
- https://aistudio.google.com/apikey → "Create API key" (Google 계정만 있으면 무료, 카드 불필요)
- 키는 `AIza...` 형식. **이 키는 아무 파일에도 붙여넣지 마세요.** 아래 3번에서 Vercel에만 등록합니다.

### 2) 이 `배포/` 폴더를 Vercel에 올리기
둘 중 하나:

**방법 ① Vercel CLI (가장 빠름)**
```
npm i -g vercel
cd 배포          # 이 폴더로 이동
vercel           # 로그인 후 안내대로 Enter (프로젝트 생성)
```

**방법 ② 웹 (GitHub 연동)**
- 이 `배포/` 폴더를 GitHub 저장소에 올림
- vercel.com → New Project → 그 저장소 Import → Deploy

> 별도 빌드 설정 필요 없음. `index.html`은 그대로 서빙되고, `api/analyze.js`는 자동으로 서버 함수가 됩니다.

### 3) 환경변수(키) 등록  ← **가장 중요**
Vercel 프로젝트 → **Settings → Environment Variables**
- Name: `GEMINI_API_KEY`
- Value: (준디 Gemini 키)
- 저장 후 **Redeploy**(재배포) 한 번 눌러야 반영됩니다.

### 4) 끝
배포된 URL로 접속하면 누구나 키 입력 없이 외식 AI 분석까지 사용 가능합니다.

---

## B. Netlify로 하려면 (대안)

Netlify는 함수 위치·형식이 달라 두 가지만 바꾸면 됩니다.

1. `api/analyze.js` 를 `netlify/functions/analyze.js` 로 옮기고, 내용의 마지막 `module.exports = async (req, res) => { ... }` 부분을 Netlify 형식으로 교체해야 합니다(핸들러 시그니처가 다름). Vercel 그대로 쓰는 게 편하면 A안을 권장합니다.
2. 프론트가 `/api/analyze`를 부르므로, `netlify.toml`에 리다이렉트 추가:
   ```toml
   [[redirects]]
     from = "/api/analyze"
     to = "/.netlify/functions/analyze"
     status = 200
   ```
3. 환경변수 `GEMINI_API_KEY` 는 Netlify → Site settings → Environment variables 에 등록.

> 특별한 이유가 없으면 **A(Vercel)** 가 이 폴더 구조 그대로 배포돼서 제일 간단합니다.

---

## 남은 위험과 권장 조치 (읽어보세요)

프록시를 써서 **키 노출은 막았지만**, 배포된 `/api/analyze` 자체는 공개 엔드포인트라 누군가 반복 호출로 무료 한도를 소진시킬 여지는 있습니다. 개인·소규모 공유면 대개 문제없지만, 널리 뿌릴 거면:

- **Google 쪽 사용량 상한 설정**: Google AI Studio / Google Cloud 콘솔에서 해당 키의 일일 요청 상한(quota)을 낮게 걸어두면, 최악의 경우에도 과금·폭주를 방지할 수 있습니다.
- **키 제한**: Cloud 콘솔에서 이 키가 **Generative Language API 한 곳에만** 쓰이도록 API 제한을 걸어두세요.
- 필요 시 간단한 요청 제한(IP당 분당 N회 등)을 프록시에 추가할 수 있습니다. 원하면 붙여드립니다.

## 로컬 개인용 버전은 따로 있습니다
`../칼로리추적기.html` (배포 폴더 밖) 은 준디 혼자 쓰는 버전으로, 설정에 본인 키를 직접 넣는 방식입니다. 배포본과 별개이니 그대로 두고 쓰시면 됩니다.
