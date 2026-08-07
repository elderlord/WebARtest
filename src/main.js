import { createHud, showBanner } from './hud.js'
import { startMockScene } from './dev/mockScene.js'

// 앱 부트스트랩.
// self-host XR8 런타임(/xr8/xr8.js)이 있으면 AR 모드로, 없으면 DEV 모드로 분기한다.
// → 사진/런타임이 없는 현재도 실기기에서 셸·HUD를 점검할 수 있다.

const app = document.getElementById('app')
const canvas = document.createElement('canvas')
canvas.id = 'camerafeed'
app.appendChild(canvas)

const hud = createHud()

// self-host XR8 런타임 경로. 배포 시 이 파일을 벤더링해 둔다 (public/xr8/README.md 참고).
const XR8_RUNTIME_URL = '/xr8/xr8.js'

loadScript(XR8_RUNTIME_URL)
  .then(() => waitForXR8(4000))
  .then(async () => {
    // AR 모드: 런타임 로드 성공 → 8th Wall 파이프라인 기동
    const { startXr8 } = await import('./ar/xr8.js')
    startXr8({ canvas, hud })
  })
  .catch((reason) => {
    // DEV 모드: 런타임 없음 → 모의 씬으로 폴백
    console.warn('[webar] XR8 런타임 미탑재 → DEV 모드로 실행:', reason)
    startMockScene({ canvas, hud })
    showBanner(
      `<b>DEV 모드</b> — AR 런타임/타겟 미탑재. three.js·HUD 점검용 모의 화면입니다.<br>` +
        `실제 AR: <code>public/xr8/</code>에 XR8 런타임을, <code>public/targets/</code>에 컴파일 타겟을 넣으세요.`
    )
  })

function loadScript(src) {
  return new Promise((resolve, reject) => {
    // 이미 인라인/사전 로드된 경우
    if (window.XR8) return resolve()
    const s = document.createElement('script')
    s.src = src
    s.async = true
    s.onload = () => resolve()
    s.onerror = () => reject(new Error(`load failed: ${src}`))
    document.head.appendChild(s)
  })
}

// XR8은 로드 후 비동기로 준비된다. window.XR8 또는 'xrloaded' 이벤트를 기다린다.
function waitForXR8(timeoutMs) {
  return new Promise((resolve, reject) => {
    if (window.XR8) return resolve()
    let done = false
    const onLoaded = () => {
      if (done) return
      done = true
      resolve()
    }
    window.addEventListener('xrloaded', onLoaded, { once: true })
    const t = setInterval(() => {
      if (window.XR8 && !done) {
        done = true
        clearInterval(t)
        resolve()
      }
    }, 100)
    setTimeout(() => {
      if (!done) {
        done = true
        clearInterval(t)
        reject(new Error('XR8 준비 시간 초과'))
      }
    }, timeoutMs)
  })
}
