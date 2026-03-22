/**
 * Gold Miner API - 用户登录和积分管理
 */

export default {
  async fetch(request, env, ctx) {
    // CORS headers
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    };

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    const url = new URL(request.url);
    const path = url.pathname;

    try {
      // 验证 Google Token
      if (path === '/api/verify') {
        return await handleVerify(request, env, corsHeaders);
      }

      // 获取用户信息
      if (path === '/api/user') {
        return await handleGetUser(request, env, corsHeaders);
      }

      // 更新积分
      if (path === '/api/score') {
        return await handleUpdateScore(request, env, corsHeaders);
      }

      // 排行榜
      if (path === '/api/leaderboard') {
        return await handleLeaderboard(env, corsHeaders);
      }

      // 健康检查
      if (path === '/api/health') {
        return jsonResponse({ status: 'ok', timestamp: new Date().toISOString() }, corsHeaders);
      }

      return jsonResponse({ error: 'Not found' }, corsHeaders, 404);
    } catch (error) {
      return jsonResponse({ error: error.message }, corsHeaders, 500);
    }
  }
};

/**
 * 验证 Google ID Token
 */
async function handleVerify(request, env, corsHeaders) {
  const { id_token } = await request.json();

  if (!id_token) {
    return jsonResponse({ error: 'Missing id_token' }, corsHeaders, 400);
  }

  // 向 Google 验证 token
  const googleResponse = await fetch(
    `https://oauth2.googleapis.com/tokeninfo?id_token=${id_token}`
  );

  if (!googleResponse.ok) {
    return jsonResponse({ error: 'Invalid token' }, corsHeaders, 401);
  }

  const googleUser = await googleResponse.json();

  // 验证 client_id
  if (googleUser.aud !== env.GOOGLE_CLIENT_ID) {
    return jsonResponse({ error: 'Invalid client' }, corsHeaders, 401);
  }

  // 检查用户是否存在
  const existingUser = await env.DB.prepare(
    'SELECT * FROM users WHERE google_id = ?'
  ).bind(googleUser.sub).first();

  if (existingUser) {
    // 更新最后登录时间
    await env.DB.prepare(
      'UPDATE users SET updated_at = CURRENT_TIMESTAMP WHERE id = ?'
    ).bind(existingUser.id).run();

    return jsonResponse({
      success: true,
      user: existingUser,
      isNewUser: false
    }, corsHeaders);
  }

  // 创建新用户
  const result = await env.DB.prepare(
    'INSERT INTO users (google_id, email, name, picture) VALUES (?, ?, ?, ?)'
  ).bind(
    googleUser.sub,
    googleUser.email || null,
    googleUser.name || 'Player',
    googleUser.picture || null
  ).run();

  const newUser = await env.DB.prepare(
    'SELECT * FROM users WHERE id = ?'
  ).bind(result.meta.last_row_id).first();

  return jsonResponse({
    success: true,
    user: newUser,
    isNewUser: true
  }, corsHeaders);
}

/**
 * 获取用户信息
 */
async function handleGetUser(request, env, corsHeaders) {
  const googleId = request.headers.get('X-Google-ID');

  if (!googleId) {
    return jsonResponse({ error: 'Missing Google ID' }, corsHeaders, 401);
  }

  const user = await env.DB.prepare(
    'SELECT * FROM users WHERE google_id = ?'
  ).bind(googleId).first();

  if (!user) {
    return jsonResponse({ error: 'User not found' }, corsHeaders, 404);
  }

  return jsonResponse({ success: true, user }, corsHeaders);
}

/**
 * 更新积分
 */
async function handleUpdateScore(request, env, corsHeaders) {
  const { google_id, score, is_high_score } = await request.json();

  if (!google_id || score === undefined) {
    return jsonResponse({ error: 'Missing parameters' }, corsHeaders, 400);
  }

  const user = await env.DB.prepare(
    'SELECT * FROM users WHERE google_id = ?'
  ).bind(google_id).first();

  if (!user) {
    return jsonResponse({ error: 'User not found' }, corsHeaders, 404);
  }

  // 更新总积分
  const newTotalScore = user.total_score + score;

  // 检查是否是新高分
  const newHighScore = is_high_score ? Math.max(user.high_score, score) : user.high_score;

  await env.DB.prepare(
    'UPDATE users SET high_score = ?, total_score = ?, updated_at = CURRENT_TIMESTAMP WHERE google_id = ?'
  ).bind(newHighScore, newTotalScore, google_id).run();

  const updatedUser = await env.DB.prepare(
    'SELECT * FROM users WHERE google_id = ?'
  ).bind(google_id).first();

  return jsonResponse({
    success: true,
    user: updatedUser,
    new_high_score: newHighScore > user.high_score
  }, corsHeaders);
}

/**
 * 获取排行榜
 */
async function handleLeaderboard(env, corsHeaders) {
  const result = await env.DB.prepare(
    'SELECT name, picture, high_score, total_score FROM users ORDER BY high_score DESC LIMIT 100'
  ).all();

  return jsonResponse({
    success: true,
    leaderboard: result.results
  }, corsHeaders);
}

/**
 * JSON 响应辅助函数
 */
function jsonResponse(data, corsHeaders, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
    },
  });
}
