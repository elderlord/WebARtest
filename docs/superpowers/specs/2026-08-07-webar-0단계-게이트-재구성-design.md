# WebAR 0단계 게이트 재구성 — 설계 스펙

> 작성: 2026-08-07 · 상태: 승인됨(사용자 + 2개 독립 리뷰 수렴)
> 원 계획서(세션 첫 메시지)와 `docs/진행현황.md`를 전제로 한 **0단계 정교화** 스펙.
> 이 문서는 브레인스토밍 + 두 차례 GPT 교차검토를 병합한 결과다.

---

## 1. 배경과 목적

기존 전시패널(재인쇄 없음)을 폰 카메라로 비추면 인쇄된 **특정 단어** 위에 시각
효과(글로우/일렁임)를 정합시키는 WebAR. 1차 성격은 **기술 검증** — "되는가/어디까지
되는가"를 효과 구현 전에 가장 싸게 판별한다.

이 스펙이 답하려는 핵심 질문:

> **스마트폰으로 기존 전시패널을 바라볼 때, 특정 인쇄 단어 위에 AR 강조효과를
> 실사용 가능한 수준으로 정확히 붙일 수 있는가?**

원 계획의 0단계는 이 질문을 사실상 하나의 게이트("추적이 되는가")로 다뤘다.
교차검토 결과, 실제 리스크는 서로 다른 층위에 있고 **각각을 분리된 게이트로
쪼개야** 실패 시 원인(렌더링/타겟/추적안정성/실패널/단어정합)을 분리할 수 있다.

## 2. 확정 전제 (§2 확인 결과, 2026-08-07)

| 항목 | 값 | 설계 함의 |
|---|---|---|
| 강조 글자 | **제목급 큰 글자** | 근접 요구 감소 → 정합 여유 ↑ |
| 패널 크기 | **소형(A3–A2, ~30–60cm 폭)** | ~30cm 이내에서만 프레임 이탈 → 읽는 거리에선 프레임에 남음 |
| 패널당 단어 | 6개+/모름 | 2단계 좌표 저작 도구 필요 확정 |
| 인쇄 마감 | 혼합/모름 | 0단계에서 유광 패널 별도 확인 |
| 패널 사진 | **아직 없음** | 0-C·0-D 블로킹 (0-A·0-B는 무관) |

**서비스 범위 전제**: 효과는 *패널을 바라보는 동안* 단어에 정합되면 된다. 패널을
벗어난 뒤 효과가 공간에 남을 필요는 없다. → 이 전제가 SLAM을 조건부로 만든다.
(전제가 바뀌면 §5의 SLAM 우선순위가 재상승한다.)

## 3. 핵심 설계 판단

### 3.1 SLAM은 처음부터 필수가 아니라 조건부다
원 계획의 SLAM 채택 근거는 "본문 5–10mm → 30–50cm 접근 → 소형 패널이 프레임
이탈 → 자세 유지 위해 SLAM". 그러나 §2에서 대상이 **제목급 글자 + 소형 패널**로
확정되며 이 사슬이 끊긴다:

```
      효과가 단어 위에서 쓸 만하게 보이는 접근 거리 (제목글자 → 멀어도 됨, ~1m)
비율 = ─────────────────────────────────────────────────────────────
        소형 패널이 프레임을 벗어나는 거리 (~30cm 이내)
```

비율 < 1 → 읽는 거리에서 패널이 프레임에 남는다 → **이미지 타겟 단독 성립 가능**.
따라서 SLAM은 "프레임 이탈" 때문이 아니라, 남는다면 오직 **소형 타겟의 원거리
자세 안정화(Pose 변동)** 때문에만 필요하다. 그 필요는 0-B가 측정으로 판정한다.

→ 결과적으로 스택이 **progressive enhancement** 구조가 된다: MIT-only로 시작,
유료/제한적 바이너리(SLAM) 의존은 측정이 요구할 때만 도입. §7 라이선스 검토도
그 시점에만 실질 blocker로 승격.

### 3.2 shimmer의 셰이더 접근성은 Phase 1의 생사 조건 → 0-A로 당김
`shimmer`가 단순 overlay가 아니라 **카메라 텍스처를 읽어 특정 영역을 변조**하는
방식이면, 그 경로가 self-host MIT 빌드에서 열리는지가 Phase 1 아키텍처를 좌우한다.
타겟 없이 런타임만으로 검증 가능하므로 0-A에 편입한다. 결과 이분화:

- 카메라 텍스처 접근 가능 → `shimmer + glow` 유지
- 접근 불가 → `glow / additive overlay` 중심으로 조기 축소

늦추면 0단계 전부 통과 후 효과 단계에서 아키텍처를 다시 바꿀 위험이 있다.

## 4. 블로커는 2개다

원 진행현황의 "패널 사진 = 유일한 블로커"는 **수정한다.**

| 블로커 | 내용 | 지금 착수 가능? |
|---|---|---|
| **A. 실제 패널 이미지 타겟** | 패널 사진 → `image-target-cli` 컴파일 | ❌ 사진 대기 |
| **B. XR8 런타임/구성 미확정** | self-host 오픈소스 런타임 실제 구성 확정 | ✅ **지금** |

A가 풀려도 B가 안 되면 현장 테스트 불가. **사진을 기다리는 동안 B(런타임 파이프라인)를
완전히 확정**하면, 사진 도착 즉시 실 타겟 테스트로 직행한다.

## 5. 수정 0단계 — 게이트 구조

```
0-A  MIT Runtime / Rendering Gate      [사진 무관 · 지금]
0-B  Image Target Gate                 [임시 인쇄 타겟]
0-B2 Conditional SLAM Gate             [0-B 부족 시에만]
0-C  Real Panel Gate                   [실 패널 사진]
0-D  Word Registration Gate            [실 패널 사진]
Phase 1  Effect (glow 우선 / shader 가능 시 shimmer A/B)
Phase 2  Authoring Tool (정규화 좌표)
```

### 0-A — MIT Runtime / Rendering Gate (지금 착수)
- self-host 오픈소스 런타임 기동 (**SLAM 제외, MIT-only**)
- 카메라 권한 / 모바일 브라우저(인앱 웹뷰 차단 포함) 확인
- three.js 통합 확인
- **카메라 텍스처 → 커스텀 셰이더 접근 smoke test** (shimmer 생사)
- **world scale / 좌표 convention calibration**: 폭 아는 평면 타겟을
  50/100/150cm에서 측정해 XR8 world scale이 실제 metric scale과 일치하는지 확인.
  통과 전엔 HUD의 cm/mm는 nominal이지 실측이 아니다.
- 게이트: 런타임이 self-host로 뜨고, 셰이더 경로/스케일 규약이 확정되는가?

### 0-B — Image Target Gate (임시 인쇄 타겟)
- 아무 인쇄물 하나로 `image-target-cli` 컴파일 → 파이프라인 전체 검증
- `imagefound / imageupdated / imagelost` 이벤트 확인
- detection distance / angle
- **Pose 변동(mm)** 측정 (아래 §6 개명·프로토콜)
- reacquisition(lost→재획득) 자연스러움
- `xr8.js`의 `scale` + `scaledWidth/Height` **이중 적용 여부 검증·수정**
- 게이트: 이미지 타겟 **단독**으로 자세 안정성이 충분한가?

### 0-B2 — Conditional SLAM Gate (0-B가 부족할 때만)
- SLAM 바이너리 추가 시 Pose 변동 개선량 측정
- 개선량이 실제 전시 UX에 유의미할 때만 채택
- 채택 시에만 XR Engine License Agreement 검토를 실질 blocker로 승격

### 0-C — Real Panel Gate (사진 확보 후)
- 실제 패널 사진 컴파일 · 전시장 조명 · glare(유광) · 실제 관람 거리·각도 · 설치 상태 · reacquire

### 0-D — Word Registration Gate (사진 확보 후)
- 외곽 wireframe **+ 제목 단어별 registration probe 3~6개**
  (좌상·중앙·우하단 등에 crosshair/rect를 겹쳐 translation·rotation·scale·
  perspective drift를 한 번에 판독)
- 위치별 정합오차 측정 → §7 KPI 판정
- 통과 시 Phase 1 진입

### Phase 1 — Effect
- 0-A 셰이더 결과에 따라: 글로우 단독(불가) 또는 글로우+shimmer A/B(가능)
- 효과 구현은 **0-D 통과 후에만** (원 계획 §9.2 유지)

### Phase 2 — Authoring Tool
- 단어 6개+ → 필요 확정. 좌표를 **픽셀이 아니라 정규화 좌표(0–1)로 저장**
  (`x:0.347, y:0.612, w:0.142, h:0.051`) → 패널 해상도 독립.

## 6. 계측 의미론 수정

### 6.1 "지터(mm)" → "Pose 변동(mm)" 개명
`metrics.js`의 최근 N프레임 `targetPos` RMS 편차는 **손떨림 + 카메라 이동 +
pose estimation 노이즈의 합**이다. "tracking precision 몇 mm"로 해석 금지.
- HUD/코드 라벨: `지터` → `Pose 변동`
- 엔진 tracking precision을 재려면 **별도 프로토콜**: 클램프/삼각대 고정 →
  3–5초 warm-up → 2–3초 sample window → median 또는 percentile. 이 고정 조건에서
  남는 변동이 곧 엔진 pose 노이즈다.

### 6.2 거리 calibration 선행
`metrics.js`는 "three 단위 = 1m" 가정 후 ×100한다. 0-A calibration 통과 전엔
실측값이라 부르지 않는다. `image-target-cli` 컴파일 시 실제 물리 폭을 입력하면
world scale이 anchor되어 calibration의 절반이 해결된다.

### 6.3 scale 이중 적용 (확인된 잠재 버그)
`src/ar/xr8.js:attachBox`가 `box.scale=scale`와 `resize(scaledWidth,scaledHeight)`를
동시에 건다. `scaledWidth`가 이미 scale 반영값이면 이중 적용. 실 런타임 연결 시 검증·수정.

## 7. 성공 기준 (Detection / Registration / Persistence)

| 항목 | 추천 기준 |
|---|---|
| 최초 인식 시간 | ≤ 1~2초 |
| 관람 거리 인식 | 예상 관람 위치에서 성공 |
| 수평/수직 각도 | 실제 관람 동선 범위에서 유지 |
| 글자 정합 오차 | 글자 높이의 ≤ 1/2 (목표 ≤ 1/3) |
| 정지 Pose 변동 | 0-A/0-B 실측 후 baseline 설정 |
| target lost → reacquire | 자연스럽게 재획득 |

## 8. 코드 영향 (뼈대 유지, 갈아엎기 없음)

| 파일 | 변경 |
|---|---|
| `src/hud.js` | `지터` → `Pose 변동` 라벨 |
| `src/ar/metrics.js` | 명칭·주석 정리, calibration 훅 자리 |
| `src/ar/xr8.js` | scale 이중적용 검증·수정 (런타임 연결 시) |
| `src/ar/alignmentBox.js` | 단어별 registration probe 추가 (사진 확보 후) |
| `public/xr8/README.md` | 공식 self-host 구조 기준으로 표현 정밀화 (0-A 산출물) |
| 신규 | 0-A 셰이더 smoke test 모듈 (카메라 텍스처 → 커스텀 셰이더) |

## 9. 결정 로그

| 결정 | 근거 |
|---|---|
| 0단계를 Runtime→Target→(SLAM)→Panel→Word 게이트로 분할 | 실패 원인 계층 분리 |
| SLAM 조건부 강등 (0-B2) | 소형패널+제목글자 → 이미지타겟 단독 가능성 · progressive enhancement · §7 리스크 지연 |
| 셰이더 smoke test를 0-A로 당김 | Phase 1 생사 조건 · 아키텍처 재작업 방지 |
| 블로커 2개 인정, 런타임(B) 지금 착수 | 사진 무관 · 사진 도착 즉시 실 타겟 직행 |
| Pose 변동 개명 · calibration 선행 | 관측량을 물리량으로 오해석 방지 |
| 단어별 probe · 정규화 좌표 | 프로젝트 본질(단어 정합) · 해상도 독립 |

## 10. 미해결 (0-A에서 확정)
- 오픈소스 엔진의 self-host 런타임 실제 artifact 구성·출처
- MIT-only로 XR8 + three.js 기동 가능성
- 카메라 텍스처 → 커스텀 셰이더 접근 경로
- three.js 버전 핀 (XR8 번들 기대 버전)
