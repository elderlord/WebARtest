# XR8 런타임 슬롯 (self-host 옵션)

> **현재 기본 로드 방식 = CDN.** 앱은 `src/ar/runtime.js`의 `RUNTIME.url`이 가리키는
> 공식 CDN(`cdn.jsdelivr.net/npm/@8thwall/engine-binary@1/dist/xr.js`)에서 런타임을
> 로드한다. GitHub Pages 배포에서 바이너리를 저장소에 안 올려도 동작하고, 우리가
> 재배포하지 않으므로 라이선스상 가장 깨끗하다. **이 폴더 벤더링은 오프라인/self-host가
> 필요할 때의 옵션이다.**

이 폴더에 **8th Wall 엔진 런타임**을 벤더링한다. self-host의 표준 파일명은 `xr.js`다.
앱은 이 런타임을 로드해 `window.XR8`을 얻는다. (self-host 시 `RUNTIME.url`을 `/xr8/xr.js`로)

> 0-A 조사(2026-08-07)로 아래 구조가 **확정**되었다. 이전의 "막연히 xr8.js를 찾는"
> 서술을 공식 self-host 구조로 대체한다.

## 확정된 self-host 방식

과거(클라우드) 방식:
```html
<script src="//apps.8thwall.com/xrweb?appKey=..."></script>   <!-- 종료됨 -->
```
현재(self-host) 방식 — 클라우드 스크립트를 제거하고 벤더링한 런타임으로 교체:
```html
<script async src="./xr.js"></script>
```

### SLAM은 별도 chunk (progressive enhancement)

**MIT-only로 시작하려면 SLAM chunk를 로드하지 않으면 된다.** 이미지 타겟 추적은
기본 런타임만으로 동작한다. 나중에 0-B 결과가 SLAM을 요구하면, 그때만 chunk를 켠다:

```html
<script async src="./xr.js" data-preload-chunks="slam"></script>
```
또는 코드에서:
```js
await XR8.loadChunk('slam')   // 엔진 시작 전 호출
```

즉 스펙의 "0-B2 조건부 SLAM"이 엔진 API 차원에서 그대로 성립한다 —
SLAM 도입은 chunk 로드 한 줄 추가이고, 그 시점에만 바이너리 라이선스 검토가
실질 blocker로 승격된다(스펙 §5, §3.1).

## 런타임 파일을 어디서 받나

- **`github.com/8thwall/engine`** — "The distributed 8th Wall Engine binary".
  여기서 `xr.js`(및 slam/face 등 chunk)를 받아 이 폴더에 벤더링한다.
- **`github.com/8thwall/8thwall`** — MIT 소스(엔진 프레임워크, Image Targets,
  `image-target-cli`, three.js/A-Frame 통합). 빌드 산출물 경로는 착수 시 확인.
- 참고 선례(계획서 §8): 관내 `nsmsuperpower.com`이 `external/xr/xr.js`,
  `xr-slam.js`를 self-host 중 — 파일 구성의 실물 참고.

## 이 앱에서의 로드 경로

현재 `src/main.js`는 `/xr8/xr8.js`를 동적 로드하도록 되어 있다. 실제 벤더링 파일명이
`xr.js`이면, `src/main.js`의 `XR8_RUNTIME_URL`을 `/xr8/xr.js`로 맞추거나 파일명을
통일한다. 런타임이 없으면 앱은 DEV 모드로 폴백한다.

## 0-A 스모크 테스트 (런타임 벤더링 후 실행)

1. `xr.js` 벤더링 → `window.XR8` 초기화 + 카메라 피드 표시 확인 (SLAM chunk 없이)
2. **카메라 텍스처 → 커스텀 셰이더 접근**: `XR8.GlTextureRenderer.pipelineModule()`이
   카메라 피드를 GPU 텍스처로 그린다. 커스텀 카메라 파이프라인 모듈에서 이 텍스처를
   프래그먼트 셰이더로 샘플·변조할 수 있는지 확인. → 가능하면 shimmer 유지, 불가하면
   글로우 단독(스펙 0-A). *이건 문서로 단정 못 하며 반드시 실행해 확인한다.*
3. world scale calibration: 폭 아는 평면 타겟을 50/100/150cm에서 측정(스펙 §6.2).
