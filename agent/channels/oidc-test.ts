import { defineChannel, GET } from "eve/channels";

const OIDC_TEST_PATH = "/oidc-test";
const OIDC_CALLBACK_PATH = "/auth/oidc/callback";

function serializeForScript(value: unknown): string {
  return JSON.stringify(value).replaceAll("<", "\\u003c");
}

function renderPage(request: Request): Response {
  const issuer = process.env.OKTA_ISSUER?.replace(/\/+$/, "") ?? "";
  const clientId = process.env.OKTA_CLIENT_ID ?? "";
  const audience = process.env.OKTA_AUDIENCE ?? "";
  const configured = Boolean(issuer && clientId && audience);
  const nonce = crypto.randomUUID().replaceAll("-", "");
  const issuerOrigin = configured ? new URL(issuer).origin : "";
  const config = serializeForScript({
    issuer,
    clientId,
    audience,
    configured,
    redirectUri: new URL(OIDC_CALLBACK_PATH, request.url).toString(),
    testPath: OIDC_TEST_PATH,
  });

  const html = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>hello-eve OIDC test</title>
  <style>
    :root { color-scheme: light dark; font-family: ui-sans-serif, system-ui, sans-serif; }
    body { margin: 0; background: #0f172a; color: #e2e8f0; }
    main { max-width: 780px; margin: 48px auto; padding: 0 20px; }
    .card { background: #111827; border: 1px solid #334155; border-radius: 16px; padding: 24px; }
    h1 { margin-top: 0; }
    p { color: #cbd5e1; line-height: 1.6; }
    code { color: #93c5fd; }
    .actions { display: flex; flex-wrap: wrap; gap: 12px; margin: 20px 0; }
    button { border: 0; border-radius: 10px; padding: 10px 16px; font: inherit; cursor: pointer; }
    button.primary { background: #2563eb; color: white; }
    button.secondary { background: #334155; color: #f8fafc; }
    button:disabled { cursor: not-allowed; opacity: .5; }
    pre { min-height: 96px; overflow: auto; white-space: pre-wrap; background: #020617; border: 1px solid #334155; border-radius: 10px; padding: 16px; color: #e2e8f0; }
    .ok { color: #86efac; }
    .error { color: #fca5a5; }
  </style>
</head>
<body>
  <main>
    <div class="card">
      <h1>hello-eve OIDC test</h1>
      <p>这个页面使用 Okta Authorization Code + PKCE 获取 access token，然后调用受 Eve <code>oidc()</code> 保护的 <code>/eve/v1/session</code>。</p>
      <p id="status">正在检查配置…</p>
      <div class="actions">
        <button id="sign-in" class="primary">使用 Okta 登录</button>
        <button id="call-agent" class="secondary">携带 token 调用 Agent</button>
        <button id="call-anonymous" class="secondary">不带 token 测试 401</button>
        <button id="clear" class="secondary">清除本页 token</button>
      </div>
      <h2>用户信息</h2>
      <pre id="profile">尚未登录</pre>
      <h2>Agent 响应</h2>
      <pre id="result">尚未调用</pre>
    </div>
  </main>
  <script nonce="${nonce}">
    const config = ${config};
    const keys = {
      accessToken: "hello-eve:oidc-test:access-token",
      expiresAt: "hello-eve:oidc-test:expires-at",
      verifier: "hello-eve:oidc-test:verifier",
      state: "hello-eve:oidc-test:state",
    };
    const statusEl = document.querySelector("#status");
    const profileEl = document.querySelector("#profile");
    const resultEl = document.querySelector("#result");
    const signInButton = document.querySelector("#sign-in");
    const callAgentButton = document.querySelector("#call-agent");

    function setStatus(message, kind = "") {
      statusEl.textContent = message;
      statusEl.className = kind;
    }

    function base64Url(bytes) {
      let binary = "";
      for (const byte of bytes) binary += String.fromCharCode(byte);
      return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
    }

    function randomValue(size = 32) {
      const bytes = new Uint8Array(size);
      crypto.getRandomValues(bytes);
      return base64Url(bytes);
    }

    async function sha256(value) {
      return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
    }

    function readAccessToken() {
      const expiresAt = Number(sessionStorage.getItem(keys.expiresAt) ?? "0");
      if (expiresAt <= Date.now()) {
        sessionStorage.removeItem(keys.accessToken);
        sessionStorage.removeItem(keys.expiresAt);
        return null;
      }
      return sessionStorage.getItem(keys.accessToken);
    }

    function clearToken() {
      for (const key of Object.values(keys)) sessionStorage.removeItem(key);
      profileEl.textContent = "尚未登录";
      resultEl.textContent = "尚未调用";
      updateButtons();
      setStatus(config.configured ? "已清除本页 token。" : "缺少 Okta 环境变量。", config.configured ? "" : "error");
    }

    function updateButtons() {
      signInButton.disabled = !config.configured;
      callAgentButton.disabled = !readAccessToken();
    }

    async function signIn() {
      const verifier = randomValue(64);
      const state = randomValue();
      sessionStorage.setItem(keys.verifier, verifier);
      sessionStorage.setItem(keys.state, state);

      const authorizeUrl = new URL(config.issuer + "/v1/authorize");
      authorizeUrl.search = new URLSearchParams({
        client_id: config.clientId,
        code_challenge: base64Url(await sha256(verifier)),
        code_challenge_method: "S256",
        redirect_uri: config.redirectUri,
        response_type: "code",
        scope: "openid profile email",
        state,
      }).toString();
      location.assign(authorizeUrl);
    }

    async function exchangeCode(code, returnedState) {
      const expectedState = sessionStorage.getItem(keys.state);
      const verifier = sessionStorage.getItem(keys.verifier);
      if (!expectedState || returnedState !== expectedState || !verifier) {
        throw new Error("OIDC state 或 PKCE verifier 无效，请重新登录。");
      }

      const response = await fetch(config.issuer + "/v1/token", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: config.clientId,
          code,
          code_verifier: verifier,
          grant_type: "authorization_code",
          redirect_uri: config.redirectUri,
        }),
      });
      const body = await response.json();
      if (!response.ok || typeof body.access_token !== "string") {
        throw new Error(body.error_description ?? body.error ?? "Okta token exchange 失败。");
      }

      sessionStorage.setItem(keys.accessToken, body.access_token);
      sessionStorage.setItem(keys.expiresAt, String(Date.now() + Number(body.expires_in ?? 3600) * 1000));
      sessionStorage.removeItem(keys.state);
      sessionStorage.removeItem(keys.verifier);
      history.replaceState({}, "", config.testPath);
      await loadProfile(body.access_token);
      setStatus("Okta 登录成功，access token 已保存到当前标签页。", "ok");
      updateButtons();
    }

    async function loadProfile(accessToken) {
      const response = await fetch(config.issuer + "/v1/userinfo", {
        headers: { authorization: "Bearer " + accessToken },
      });
      profileEl.textContent = response.ok
        ? JSON.stringify(await response.json(), null, 2)
        : "UserInfo 请求失败：HTTP " + response.status;
    }

    async function callAgent(withToken) {
      resultEl.textContent = "请求中…";
      const headers = { "content-type": "application/json" };
      if (withToken) {
        const token = readAccessToken();
        if (!token) throw new Error("当前标签页没有有效的 access token。");
        headers.authorization = "Bearer " + token;
      }
      const response = await fetch("/eve/v1/session", {
        method: "POST",
        headers,
        body: JSON.stringify({ message: "Reply with exactly: OIDC OK" }),
      });
      resultEl.textContent = "HTTP " + response.status + "\\n\\n" + await response.text();
    }

    signInButton.addEventListener("click", () => signIn().catch(error => setStatus(error.message, "error")));
    callAgentButton.addEventListener("click", () => callAgent(true).catch(error => { resultEl.textContent = error.message; }));
    document.querySelector("#call-anonymous").addEventListener("click", () => callAgent(false).catch(error => { resultEl.textContent = error.message; }));
    document.querySelector("#clear").addEventListener("click", clearToken);

    async function start() {
      if (!config.configured) {
        setStatus("缺少 OKTA_ISSUER、OKTA_CLIENT_ID 或 OKTA_AUDIENCE。", "error");
        updateButtons();
        return;
      }

      const params = new URLSearchParams(location.search);
      const error = params.get("error");
      if (error) throw new Error(params.get("error_description") ?? error);
      const code = params.get("code");
      if (code) {
        await exchangeCode(code, params.get("state"));
        return;
      }

      const accessToken = readAccessToken();
      if (accessToken) {
        await loadProfile(accessToken);
        setStatus("当前标签页已有有效的 Okta access token。", "ok");
      } else {
        setStatus("尚未登录。先测试匿名请求，再使用 Okta 登录。", "");
      }
      updateButtons();
    }

    start().catch(error => {
      setStatus(error instanceof Error ? error.message : String(error), "error");
      updateButtons();
    });
  </script>
</body>
</html>`;

  const connectSources = issuerOrigin ? ` 'self' ${issuerOrigin}` : " 'self'";
  return new Response(html, {
    headers: {
      "cache-control": "no-store",
      "content-security-policy": `default-src 'none'; connect-src${connectSources}; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
      "content-type": "text/html; charset=utf-8",
      "referrer-policy": "no-referrer",
    },
  });
}

export default defineChannel({
  routes: [
    GET(OIDC_TEST_PATH, async (request) => renderPage(request)),
    GET(OIDC_CALLBACK_PATH, async (request) => renderPage(request)),
  ],
});
