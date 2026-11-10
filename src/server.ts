// 抖音云 text-check 服务的代码。用它整个替换 fork 后仓库里的 src/server.ts。
// 基于官方模板 bytedance/douyincloud-nodejs-koa-demo（template 分支），只改了文字检测这一个接口：
// 抖音云对小游戏没有自动鉴权（直接调用会返回 401 bad access_token），所以这里自己用 AppSecret 换 token。
//
// 在抖音云控制台给服务配置两个环境变量（只填在控制台，不要写进代码，也不要发给任何人）：
//   APP_ID      小游戏 AppID
//   APP_SECRET  小游戏 AppSecret
//
// 返回格式和模板保持一致：{ success, result }，result 是开放平台检测接口的原始返回。

import Koa from 'koa';
import bodyParser from 'koa-bodyparser';
import Router from '@koa/router';
import axios from 'axios';

const TOKEN_URL = 'https://minigame.zijieapi.com/mgplatform/api/apps/v2/token';
const ANTIDIRT_URL = 'https://developer.toutiao.com/api/v2/tags/text/antidirt';

// token 有效期 2 小时；每个实例自己缓存，提前 20 分钟刷新。
// 官方说明：重新获取后旧 token 还能用 5 分钟，所以少量实例各自刷新不会互相顶掉。
let cachedToken = '';
let tokenExpiresAt = 0;

async function getAccessToken(): Promise<string> {
  if (cachedToken && Date.now() < tokenExpiresAt) return cachedToken;
  const res = await axios.post(
    TOKEN_URL,
    { appid: process.env.APP_ID, secret: process.env.APP_SECRET, grant_type: 'client_credential' },
    { headers: { 'content-type': 'application/json' }, timeout: 5000 },
  );
  const data = res.data || {};
  if (data.err_no !== 0 || !data.data || !data.data.access_token) {
    throw new Error(`get token failed: ${data.err_no} ${data.err_tips}`);
  }
  cachedToken = data.data.access_token;
  tokenExpiresAt = Date.now() + (Number(data.data.expires_in || 7200) - 1200) * 1000;
  return cachedToken;
}

const app = new Koa();
const router = new Router();

router
  .get('/', (ctx) => {
    ctx.body = 'text-check service';
  })
  .post('/api/text/antidirt', async (ctx) => {
    const body: any = ctx.request.body || {};
    const content = String(body.content || '').slice(0, 50);
    if (!content.trim()) {
      ctx.body = { success: false, result: { code: 400, message: 'empty content' } };
      return;
    }
    try {
      const token = await getAccessToken();
      const res = await axios.post(
        ANTIDIRT_URL,
        { tasks: [{ content }] },
        { headers: { 'X-Token': token, 'content-type': 'application/json' }, timeout: 5000 },
      );
      if (res.data && res.data.code === 401) cachedToken = ''; // token 失效就下次重取
      ctx.body = { success: true, result: res.data };
    } catch (err: any) {
      console.log('antidirt failed:', err && err.message);
      ctx.body = { success: false, result: { code: 500, message: 'check failed' } };
    }
  });

app.use(bodyParser());
app.use(router.routes());

const PORT = 8000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
