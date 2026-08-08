# 이미지 타겟

앱은 `manifest.json`에 적힌 이름을 읽어 각 `<name>.json`을 런타임에 로드하고,
`XR8.XrController.configure({ imageTargetData: [...] })`로 주입한다
(`src/ar/xr8.js`의 `loadImageTargets`).

```
manifest.json          { "targets": ["target0b"] }
<name>.json            image-target-cli 메타데이터
<name>_luminance.png   추적에 실제로 쓰이는 그레이스케일 이미지
```

`<name>.json`의 `imagePath`는 CLI 기본값이 `image-targets/…`라서, 로더가 실제
서빙 경로(`<base>/targets/<file>`)로 교정한다.

## 현재 타겟

### `target0b` — 0-B 테스트 타겟 (자체 생성)

`target0b.png`가 원본이다. **A4(210×297mm) 규격**으로 만들었다.

포함 요소와 의도:

| 요소 | 목적 |
|---|---|
| 바깥 테두리 | 우리 와이어프레임 정합박스와 육안 비교 → **정합 오차 측정 기준** |
| 비대칭 코너 마커(22/16/12/8mm) | 회전 모호성 제거 |
| 비반복 고대비 도형 다수 | 추적 특징점 공급 |
| 제목급 큰 글자 3개(생각/중/실측) | 0-D 단어 정합 probe 예행 대상 |
| 100mm 눈금자 | **world scale calibration**(스펙 §6.2) 교차검증 |

**사용법**: `<사이트>/targets/target0b.png`를 열어 **A4에 100% 배율로 인쇄**하거나
모니터에 띄운 뒤, 앱으로 비춘다. 인쇄하면 실제 폭이 210mm로 확정되어 거리·스케일
검증이 가능하다(모니터 표시는 파이프라인 검증용으로는 충분하나 반사·모아레 주의).

## 새 타겟 추가

```bash
npx @8thwall/image-target-cli@latest      # 이미지 경로 → flat → 크롭 → 출력폴더 → 이름
```
산출물 중 `<name>.json`과 `<name>_luminance.png`를 이 폴더에 넣고
`manifest.json`의 `targets` 배열에 이름을 추가한다.
(원본/크롭/썸네일은 추적에 불필요하며 용량만 차지한다)

## 동시 로드 개수 (계획서 §6)

한 세션에 몇 개까지 안정적으로 물릴 수 있는지는 실측 대상이다. 10개 패널이 한 번에
안 되면 전시 구역별로 타겟 세트를 분할 로드한다.
