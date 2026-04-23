# Metaball Playground — 3~4시간 속성 학습 노트

> **목표**: 초심자 그래픽 엔지니어가 이 토이의 핵심(SDF / smooth-min / 프래그먼트-only 렌더링 / 데이터 흐름)을 3~4시간 안에 스스로 설명 가능 수준까지.
> **현재 코드 상태**: Week 1 — **WebGL2 전용**, **2D** screen-space SDF. (WebGPU·raymarching·3D는 아직 없음.)

---

## Phase 별 체크리스트

- [ ] **Phase 1 — 감 잡기** (45분) · 아래 §1 브리프 읽기 + 브라우저 데모 조작
- [ ] **Phase 2 — 셰이더 정독** (75분) · `src/render/shaders/metaball.glsl` 위→아래
- [ ] **Phase 3 — TS 파이프라인** (45분) · bootstrap → loop → store → uniforms
- [ ] **Phase 4 — 빈틈 점검** (30~45분) · 아래 §4 L1/L2 5문항 셀프 드릴

---

## §1. Phase 1 · 1페이지 브리프

### 1.1 한 줄 정의
**"여러 개의 부드러운 원(blob)이 서로 붙어 녹듯 합쳐지는 2D 화면"** — 이 효과를 **SDF + smooth-min + 풀스크린 프래그먼트 셰이더 1장**으로 그린다.

### 1.2 왜 이 기법인가 (SDF 관점)
- 블롭의 "붙음"을 모델링하려면 **두 표면이 가까울수록 경계가 녹아야** 한다.
- 전통 3D 메시로 하려면 mesh 변형·재토폴로지가 지옥.
- SDF는 "점 p에서 가장 가까운 표면까지의 부호 있는 거리 `d(p)`"를 함수로 본다 → 표면은 `d=0`.
- 여러 SDF의 `min`을 취하면 합집합(union)인데, `min`은 꺾여서 경계가 날카롭다. **smooth-min**으로 바꾸면 그 꺾임이 둥글게 녹는다 — 이게 "붙는" 효과의 정체.
- 픽셀마다 `d(p)` 한 번 계산해서 `d ≤ 0`이면 내부, 아니면 배경. AA는 `smoothstep(0, aa, d)`로.

### 1.3 데이터 흐름 (머리에 박아둘 파이프라인)

```
[CPU · JS]                          [GPU · 프래그먼트 셰이더]
───────────────────────────         ───────────────────────────
appStore (zustand)
  sim params, blobs[] (pos,r,color)
        │
        ▼
physics.step (Verlet 적분)     ──►  uBlobsXYZR[MAX_BLOBS] (vec4)
  중력·인력·포인터·경계               uColors[MAX_BLOBS]    (vec3)
                                     uK, uAA, uColorSoftness,
                                     uBackground, uBloom, uVignette, uRim
                                           │
                                           ▼
                               풀스크린 삼각형 1개
                               (버텍스는 거의 무의미)
                                           │
                                           ▼
                               for i in 0..count:
                                 d = smin(d, sdCircle(p, b.xy, b.z), k)
                                 color += b.color · exp(-max(d_i,0)·softness)
                               mask = 1 - smoothstep(0, aa, d)
                               + rim + bloom + vignette
                                           │
                                           ▼
                                       픽셀 출력
```

매 프레임: **CPU에서 blob 배열 갱신 → uniform 업로드 → GPU가 픽셀마다 독립적으로 위 loop 실행.**

### 1.4 3대 개념 (면접·실무에서 말할 수 있어야 함)

**(A) SDF (Signed Distance Field)**
- 원(circle): `sdCircle(p, c, r) = |p − c| − r`. 안쪽 음수, 경계 0, 바깥 양수.
- 장점: 합집합·부풀리기·음영·그림자·AA가 "거리 함수" 하나로 통일됨.

**(B) Smooth-min (polynomial)**
```
h = max(k − |a − b|, 0) / k
smin(a, b, k) = min(a, b) − h² · k · 0.25
```
- `k=0`이면 그냥 `min` (날카로운 union).
- `k`가 커지면 두 SDF가 `k`만큼 떨어져 있을 때부터 섞이기 시작 → 블롭이 더 먼 거리에서 "끌어당겨" 합쳐짐.
- 감소량 `h²·k/4`는 항상 ≤ k/4 ≤ 원래 min값보다 작게 빠져 SDF 성질을 크게 깨지 않음.
- 이 구현의 `uK`는 `0.001 + blobSmoothness · 0.5` (world units).

**(C) Full-screen triangle + fragment-only 렌더링**
- 버텍스 3개짜리 삼각형 **하나**로 [-1,3]² 영역을 덮고 스크린(NDC [-1,1]²)만 scissor. 삼각형 2개짜리 쿼드보다 픽셀 경계선에서 overdraw/이음새 없음.
- 씬에는 mesh 1개, 카메라는 그냥 Orthographic 자리채움. **진짜 그림은 fragment shader가 혼자 다 그린다.**
- depth test/write 끔 (깊이가 없으니).

### 1.5 현재 코드가 **아직 안 하는 것** (중요, 오해 방지)
- **Raymarching 아님** — 2D 화면 공간에서 `d(p)` 한 번이면 됨. 3D는 Week 2+ 로드맵.
- **WebGPU 아직 미사용** — `metaball.wgsl`은 Week 2 포팅 참조용이고, 실제 실행 경로는 `metaball.glsl`. `renderer.ts`에서 `backend: 'webgl2'`로 고정.
- **3D normal 계산 없음** — rim·bloom은 `d` 자체를 이용한 **근사**. ("진짜" normal은 SDF gradient ∇d = `(d(p+εx)−d(p−εx))/2ε` 등의 유한차분. 3D 토이에서 등장 예정.)

### 1.6 파일 지도 (Phase 2·3에서 열 파일들)

| 역할 | 파일 | 보는 포인트 |
|---|---|---|
| **셰이더 본체** (Phase 2 메인) | [src/render/shaders/metaball.glsl](src/render/shaders/metaball.glsl) | 전체 78줄. `main()`의 loop + rim/bloom/vignette |
| 참고용 WGSL | [src/render/shaders/metaball.wgsl](src/render/shaders/metaball.wgsl) | 하드코딩 3블롭. Week 1에선 안 씀 |
| ShaderMaterial + uniform 정의 | [src/render/material.ts](src/render/material.ts) | uniform 이름·타입 = GLSL의 `uniform`과 1:1 |
| 풀스크린 삼각형 | [src/render/fullscreen-quad.ts](src/render/fullscreen-quad.ts) | 왜 좌표가 [-1,-1, 3,-1, -1,3]인지 |
| 렌더러 선택 | [src/render/renderer.ts](src/render/renderer.ts) | WebGPU 감지만 하고 WebGL2 고정 |
| 앱 시작 | [src/app/bootstrap.ts](src/app/bootstrap.ts) | 모든 것을 조립 |
| 프레임 루프 | [src/app/loop.ts](src/app/loop.ts) | **물리→uniform 업로드→render** 한 프레임 |
| 상태 | [src/state/store.ts](src/state/store.ts) | zustand. MAX_BLOBS=32, 기본 6개 |
| 물리 (Verlet) | [src/sim/physics.ts](src/sim/physics.ts) | position-Verlet. 중력/인력/포인터/경계 |
| blob 생성 | [src/sim/blob.ts](src/sim/blob.ts) | `mass = r²` 등 |
| smin 유틸 (CPU) | [src/util/smin.ts](src/util/smin.ts) | 셰이더 smin과 수식 동일 |

---

## §2. Phase 2 · 셰이더 정독 기록란

> 파일: [src/render/shaders/metaball.glsl](src/render/shaders/metaball.glsl)
> 섹션마다 본인 이해를 1~2줄로 적고, 막히면 Claude에 질의.

### 2.1 상단 uniform 블록 (1~22줄)
본인 메모: 

### 2.2 `sdCircle`, `smin` (23~31줄)
본인 메모: 
질문: 

### 2.3 `main` — NDC → world p (33~36줄)
본인 메모 (`aspect` 왜 곱하는지): 

### 2.4 `main` — 블롭 합성 루프 (38~51줄)
본인 메모 (`MAX_BLOBS` 고정 루프 + `if i >= count break`): 
왜 `uniform vec4 uBlobsXYZR[MAX_BLOBS]`는 동적 크기 배열이 안 되는가? → 본인 답: 

### 2.5 `main` — color 가중 평균 (47~53줄)
본인 메모 (`exp(-max(d_i,0)·softness)` 가중치의 의미): 

### 2.6 `main` — mask / rim / bloom / vignette (55~77줄)
본인 메모: 
이 코드의 "rim"과 "bloom"이 **진짜 3D rim light / bloom과 어떻게 다른가?**

---

## §3. Phase 3 · TS 파이프라인 추적

> 읽는 순서: bootstrap → material → loop → store → physics.

### 3.1 [src/app/bootstrap.ts](src/app/bootstrap.ts)
한 줄 요약: 
의문점: 

### 3.2 [src/render/material.ts](src/render/material.ts)
GLSL의 `uniform vec4 uBlobsXYZR[MAX_BLOBS]`는 TS에서 무엇에 대응? 
`MAX_BLOBS`는 어디서 어떻게 GLSL로 전달? 

### 3.3 [src/app/loop.ts](src/app/loop.ts)
한 프레임 안에서 일어나는 일을 번호로 적기:
1. 
2. 
3. 
4. 

### 3.4 [src/sim/physics.ts](src/sim/physics.ts)
왜 velocity를 따로 저장 안 하고 `pos - prev`로 구하는가 (position-Verlet)? 
`MAX_SUBSTEPS=3`, `FIXED_DT=1/120`의 의도는? 

### 3.5 [src/state/store.ts](src/state/store.ts)
store가 변경될 때 GPU에 언제 반영되는가? (직접 반영? 다음 프레임에서?) 

---

## §4. Phase 4 · 빈틈 점검 드릴 (본인 답 먼저)

> 각 문항에 2~4문장으로 직접 답한 뒤 Claude에 채점 요청. 목적은 정답이 아니라 **언어화 훈련**.

### L1 (개념)
- **Q1** "SDF가 뭔가요? 왜 블롭에 SDF를 쓰나요?"
  내 답: 
- **Q2** "풀스크린 삼각형을 쿼드 대신 쓰는 이유?"
  내 답: 
- **Q3** "`smin`과 `min`은 결과가 어떻게 다른가요? `k`가 의미하는 것은?"
  내 답: 

### L2 (구현)
- **Q4** "블롭 N개일 때 **픽셀 당** 몇 번의 `sdCircle` 호출이 일어나나요? 화면 1920×1080이면 프레임당 총 몇 번?"
  내 답: 
- **Q5** "`uBlobsXYZR`는 `vec4` 배열이다. 4번째 성분(w)은 뭐가 들어가나? 왜 낭비처럼 보여도 그렇게 한 것 같은가?"
  내 답: 
- **Q6** "현재 코드의 'rim light'는 3D 모델의 rim light와 뭐가 다른가? (normal을 구하나?)"
  내 답: 

### L3 (판단 · 시간 남으면)
- **Q7** "블롭이 10 → 100개가 된다고 했을 때 병목은 어디일 것 같은가? 프로파일링 없이도 추정하는 근거?"
  내 답: 
- **Q8** "WebGL2에서 WebGPU로 넘어갈 때 `metaball.wgsl`과 `metaball.glsl` **둘 다** 유지해야 하는 이유와 동기화 전략?"
  내 답: 

---

## §5. 평가 — Portfolio slide 다시 쓰기 (선택)

> 시간 남으면 `../../portfolio/playground-metaball.md`의 Problem / Solution / Result / Keywords를 본인 언어로.

### Problem
### Solution
### Result
### Keywords

---

## §6. 약점 기록

> 드릴 중 "말로 설명이 안 되는 것"만 여기 적어두고 돌아가서 다시 읽을 파일을 메모.

- 약점: 
  돌아갈 파일: 
- 약점: 
  돌아갈 파일: 
