import { createHud, showBanner } from './hud.js'
import { startMockScene } from './dev/mockScene.js'
import { RUNTIME, loadRuntime } from './ar/runtime.js'
import { showAttribution } from './ar/attribution.js'

// 앱 부트스트랩.
// 런타임 어댑터(runtime.js)가 XR8 런타임을 로드하면 AR 모드로, 없으면 DEV 모드로 분기.
// 경로 A/B 차이는 runtime.js의 RUNTIME config에만 있고 아래 코드는 불변이다.
//
// 두 실패를 반드시 구분한다:
//   (1) 런타임 로드 실패 → DEV 모드(모의 씬)
//   (2) 런타임은 로드됐으나 startXr8()이 실패 → 실제 에러를 화면에 표시(0-A 진단)
// 이전엔 하나의 catch가 둘을 뭉뚱그려 (2)가 DEV 모드로 위장됐다.

// main.js가 실행되면 부팅 진단 문구 제거 + 자가복구 플래그 리셋 (index.html의 #boot)
document.getElementById('boot')?.remove()
try {
  sessionStorage.removeItem('_reloadOnce')
} catch {}

// 빌드 식별자를 화면 좌하단에 찍는다 → 새 빌드/캐시 구분용 (vite define)
const BUILD_ID = typeof __BUILD_ID__ !== 'undefined' ? __BUILD_ID__ : 'dev'
{
  const s = document.createElement('div')
  s.textContent = `build ${BUILD_ID}`
  s.style.cssText =
    'position:fixed;left:8px;bottom:calc(env(safe-area-inset-bottom,0px) + 8px);z-index:12;' +
    'font:10px -apple-system,sans-serif;color:#9ca3af;background:rgba(17,24,39,.7);' +
    'padding:2px 6px;border-radius:5px'
  document.body.appendChild(s)
}

// 0-A 디버깅: 삼켜지는 에러가 없도록 전역 에러를 화면에 노출한다.
let errShown = false
const surfaceError = (label, msg) => {
  if (errShown) return
  errShown = true
  showBanner(`<b>${label}</b><br>${String(msg).slice(0, 300)}`)
}
window.addEventListener('error', (e) => surfaceError('JS 에러', e.message))
window.addEventListener('unhandledrejection', (e) =>
  surfaceError('Promise 거부', e.reason && e.reason.message ? e.reason.message : e.reason)
)

const app = document.getElementById('app')
const canvas = document.createElement('canvas')
canvas.id = 'camerafeed'
app.appendChild(canvas)

const hud = createHud()

loadRuntime(RUNTIME).then(
  async () => {
    // 런타임 로드 성공 (window.XR8 준비됨)
    if (RUNTIME.requiresAttribution) showAttribution()
    try {
      const { startXr8 } = await import('./ar/xr8.js')
      const shaderSmokeTest = new URLSearchParams(location.search).has('smoke')
      startXr8({ canvas, hud, shaderSmokeTest })
    } catch (err) {
      // 런타임은 있으나 파이프라인 시작 실패 → DEV로 위장하지 말고 실제 원인 표시
      console.error('[webar] startXr8 실패:', err)
      surfaceError('AR 시작 실패 (런타임은 로드됨)', err && err.message ? err.message : err)
    }
  },
  (reason) => {
    // 런타임 로드 자체 실패 → DEV 모드(모의 씬)
    console.warn('[webar] XR8 런타임 미로드 → DEV 모드:', reason)
    startMockScene({ canvas, hud })
    showBanner(
      `<b>DEV 모드</b> — XR8 런타임 미로드. three.js·HUD 점검용 모의 화면입니다.<br>` +
        `런타임 로드 실패 사유는 콘솔 참고.`
    )
  }
)
