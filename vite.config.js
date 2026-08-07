import { defineConfig } from 'vite'
import basicSsl from '@vitejs/plugin-basic-ssl'

// 카메라 접근은 보안 컨텍스트(HTTPS 또는 localhost)에서만 허용된다.
// 폰으로 LAN에서 접속해 실측하려면 HTTPS가 필수이므로 dev 서버에 자체 서명 인증서를 켠다.
// (실측 시 폰 브라우저에서 인증서 경고를 한 번 수락해야 한다. 배포는 정식 HTTPS로.)
export default defineConfig({
  // GitHub Pages 프로젝트 사이트는 https://<user>.github.io/WebARtest/ 로 서빙된다.
  // 절대 base로 고정해야 끝 슬래시 없는 주소(.../WebARtest)로 열어도 자산 경로가
  // github.io 루트로 새지 않는다. (상대 './'는 끝 슬래시 없을 때 404 → 백지)
  base: '/WebARtest/',
  plugins: [basicSsl()],
  server: {
    host: true, // 0.0.0.0 바인딩 → 같은 Wi-Fi의 폰에서 접속 가능
    port: 5173,
  },
  preview: {
    host: true,
    port: 4173,
  },
})
