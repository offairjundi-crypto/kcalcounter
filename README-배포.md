# 칼로리 추적기 — 배포 가이드

프론트엔드(정적 HTML) + 서버 함수(프록시) + 로그인/계정별 저장(Supabase) 구조.
- **Gemini API 키**는 서버 환경변수로만 두고 브라우저엔 안 나옵니다.
- **로그인**하면 기록이 계정에 저장되어, 어느 기기에서 로그인해도 그대로 유지됩니다. 사용자끼리 기록은 서로 안 보입니다(RLS 보안).

```
배포/
  index.html            ← 프론트엔드 (로그인 화면 포함, Supabase 키 2개 입력 필요)
  api/analyze.js         ← 서버 함수: 환경변수 GEMINI_API_KEY 로 Gemini 호출
  manifest.json          ← PWA 매니페스트 (앱 이름·아이콘·색)
  sw.js                  ← 서비스워커 (오프라인 화면 + 재배포 시 자동 업데이트)
  icon-192.png / icon-512.png / apple-touch-icon.png  ← 앱 아이콘
  README-배포.md         ← 이 문서
```

> **배포 전 필수 3가지**: ① Vercel에 `GEMINI_API_KEY` 환경변수(아래 A-3), ② `index.html` 상단에 Supabase URL/anon 키(아래 C), ③ Supabase 테이블·보안규칙(아래 C).

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

## C. 로그인 설정 (Supabase · 무료) — 필수

로그인과 계정별 저장은 Supabase가 담당합니다. 아래 순서대로 하면 됩니다.

### 1) Supabase 프로젝트 생성
- https://supabase.com → 로그인 → **New project** (무료 플랜). 이름·비밀번호 아무거나, 지역은 가까운 곳(예: Northeast Asia).

### 2) 키 2개 복사 → `index.html`에 붙여넣기
- Supabase 프로젝트 → **Settings → API**
  - **Project URL** (예: `https://xxxxxxxx.supabase.co`)
  - **anon public** 키 (`Project API keys`의 `anon` 값)
- `index.html` 맨 위 `<script>` 안의 이 두 줄을 교체:
  ```js
  const SUPABASE_URL = "여기에_SUPABASE_URL_입력";      // ← Project URL
  const SUPABASE_ANON_KEY = "여기에_ANON_KEY_입력";     // ← anon public 키
  ```
  > anon 키는 **공개돼도 안전**합니다(브라우저용 공개 키). 실제 데이터 보호는 아래 3)의 보안규칙(RLS)이 합니다. `service_role` 키는 절대 여기 넣지 마세요.

### 3) 테이블 + 보안규칙(RLS) 만들기 — SQL 복붙
- Supabase 프로젝트 → **SQL Editor** → New query → 아래 그대로 붙여넣고 **Run**:
  ```sql
  create table if not exists public.user_data (
    user_id uuid primary key references auth.users(id) on delete cascade,
    data jsonb not null default '{}'::jsonb,
    updated_at timestamptz not null default now()
  );
  alter table public.user_data enable row level security;
  create policy "own_select" on public.user_data for select using (auth.uid() = user_id);
  create policy "own_insert" on public.user_data for insert with check (auth.uid() = user_id);
  create policy "own_update" on public.user_data for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
  ```
  이 규칙 덕분에 **각 사용자는 자기 데이터 행만** 읽고 쓸 수 있습니다(남의 기록 접근 불가).

### 4) (선택) 이메일 확인 끄기 — 가입 즉시 로그인되게
- 기본값은 **가입 시 확인 메일**을 보냅니다(메일 링크 클릭 후에야 로그인 가능).
- 바로 쓰게 하려면: **Authentication → Sign In / Providers → Email → "Confirm email" 토글 OFF**.
- 켜둔 채로 써도 됩니다(더 안전). 그 경우 앱이 "확인 메일을 보냈습니다" 안내를 띄웁니다.

### 5) 확인
- 배포한 주소로 접속 → 로그인 화면이 뜸 → **회원가입** 후 로그인 → 기록해보고, 다른 기기(또는 시크릿창)에서 같은 계정으로 로그인하면 기록이 그대로 보이면 성공.

> Supabase 값을 안 넣으면 로그인 화면에 "서버(Supabase) 설정이 필요합니다"가 뜨고 버튼이 비활성화됩니다.

### 6) 소셜 로그인(카카오·Google) 켜기
로그인 화면의 "카카오로 시작하기" / "Google로 시작하기" 버튼을 쓰려면 각 제공자를 Supabase에 한 번씩 연결해야 합니다. **연결 전에 버튼을 누르면 오류가 나니**, 안 쓸 제공자는 연결하거나 index.html에서 해당 버튼을 지우세요.

**공통 준비**
- Supabase → **Authentication → URL Configuration → Site URL** 에 배포 주소(`https://....vercel.app`) 입력 (로그인 후 되돌아올 주소)
- 아래에서 쓸 **콜백 주소**: `https://<프로젝트ID>.supabase.co/auth/v1/callback`
  (Supabase → Authentication → Providers → 각 제공자 화면에 "Callback URL"로 표시되어 있음 — 그걸 복사해 쓰면 됨)

**카카오**
1. https://developers.kakao.com → 내 애플리케이션 → **애플리케이션 추가**
2. 앱 설정 → 플랫폼 → **Web**에 배포 주소 등록
3. 카카오 로그인 **활성화** → **Redirect URI**에 위 콜백 주소 등록
4. 카카오 로그인 → 보안 → **Client Secret 생성 + 활성화**
5. 앱 키의 **REST API 키**(=Client ID)와 Client Secret을 Supabase → Authentication → Providers → **Kakao**에 입력 후 Enable
- 이메일 동의항목은 카카오 정책상 비즈 앱 전환이 필요할 수 있습니다. 메뉴 이름이 다르면 공식 가이드 기준으로: https://supabase.com/docs/guides/auth/social-login/auth-kakao

**Google**
1. https://console.cloud.google.com → 프로젝트 생성 → APIs & Services → **OAuth consent screen** 작성 (External, 앱 이름·이메일 정도만)
2. **Credentials → Create Credentials → OAuth client ID → Web application**
3. **Authorized redirect URIs**에 위 콜백 주소 등록
4. 발급된 Client ID / Client Secret을 Supabase → Authentication → Providers → **Google**에 입력 후 Enable
- 가이드: https://supabase.com/docs/guides/auth/social-login/auth-google

---

## D. 폰에 앱처럼 설치 (PWA)

배포된 주소를 폰 브라우저로 열고:

- **아이폰**: Safari로 접속 → 하단 **공유 버튼** → **"홈 화면에 추가"** → 홈 화면에 🥗 아이콘 생성, 앱처럼 전체화면 실행
- **삼성/안드로이드**: Chrome으로 접속 → 메뉴(⋮) → **"앱 설치"** 또는 "홈 화면에 추가"

특징:
- 인터넷이 잠깐 끊겨도 화면은 뜹니다(오프라인 캐시). 단, 로그인·동기화·AI 분석은 인터넷 필요.
- **재배포하면 앱도 자동으로 새 버전을 받습니다** (네트워크 우선 방식이라 옛 화면에 갇히지 않음).

## 재배포와 데이터 — 안심하세요

- **기록은 재배포와 무관하게 유지됩니다.** 로그인 사용자의 기록은 **Supabase 서버**에 있고, Vercel 재배포는 앱 화면(코드)만 갈아끼울 뿐 데이터는 건드리지 않습니다.
- 재배포 시 사라지는 건 아무것도 없습니다. 데이터가 사라지는 경우는 Supabase 프로젝트를 삭제하는 경우뿐입니다.

---

## 남은 위험과 권장 조치 (읽어보세요)

프록시를 써서 **키 노출은 막았지만**, 배포된 `/api/analyze` 자체는 공개 엔드포인트라 누군가 반복 호출로 무료 한도를 소진시킬 여지는 있습니다. 개인·소규모 공유면 대개 문제없지만, 널리 뿌릴 거면:

- **Google 쪽 사용량 상한 설정**: Google AI Studio / Google Cloud 콘솔에서 해당 키의 일일 요청 상한(quota)을 낮게 걸어두면, 최악의 경우에도 과금·폭주를 방지할 수 있습니다.
- **키 제한**: Cloud 콘솔에서 이 키가 **Generative Language API 한 곳에만** 쓰이도록 API 제한을 걸어두세요.
- 필요 시 간단한 요청 제한(IP당 분당 N회 등)을 프록시에 추가할 수 있습니다. 원하면 붙여드립니다.

## 로컬 개인용 버전은 따로 있습니다
`../칼로리추적기.html` (배포 폴더 밖) 은 준디 혼자 쓰는 버전으로, 설정에 본인 키를 직접 넣는 방식입니다. 배포본과 별개이니 그대로 두고 쓰시면 됩니다.
