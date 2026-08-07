import { createHud, showBanner } from './hud.js'
import { startMockScene } from './dev/mockScene.js'
import { RUNTIME, loadRuntime } from './ar/runtime.js'
import { showAttribution } from './ar/attribution.js'

// 앱 부트스트랩.
// 런타임 어댑터(runtime.js)가 self-host XR8 런타임을 로드하면 AR 모드로,
// 없으면 DEV 모드로 분기한다. → 사진/런타임이 없어도 실기기에서 셸 점검 가능.
// 경로 A/B 차이는 runtime.js의 RUNTIME config에만 있고 아래 코드는 불변이다.

const app = document.getElementById('app')
const canvas = document.createElement('canvas')
canvas.id = 'camerafeed'
app.appendChild(canvas)

const hud = createHud()

loadRuntime(RUNTIME)
  .then(async () => {
    // AR 모드: 런타임 로드 성공
    // §1.3 귀속표시 — 경로 A(바이너리) 사용 시 필수
    if (RUNTIME.requiresAttribution) showAttribution()
    const { startXr8 } = await import('./ar/xr8.js')
    // ?smoke → 0-A 셰이더 스모크 테스트 활성화
    const shaderSmokeTest = new URLSearchParams(location.search).has('smoke')
    startXr8({ canvas, hud, shaderSmokeTest })
  })
  .catch((reason) => {
    // DEV 모드: 런타임 없음 → 모의 씬으로 폴백
    console.warn('[webar] XR8 런타임 미탑재 → DEV 모드로 실행:', reason)
    startMockScene({ canvas, hud })
    showBanner(
      `<b>DEV 모드</b> — AR 런타임/타겟 미탑재. three.js·HUD 점검용 모의 화면입니다.<br>` +
        `실제 AR: <code>public/xr8/</code>에 XR8 런타임(<code>xr.js</code>)을, ` +
        `<code>public/targets/</code>에 컴파일 타겟을 넣으세요.`
    )
  })
