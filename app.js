// ============================================================
// STATE
// ============================================================
let currentAuthUser = null;   // từ supabase auth
let currentProfile = null;    // hàng trong bảng public.users
let fieldsCache = [];
let view = 'landing';
let notifCount = 0;

function escapeHtml(s){ const d=document.createElement('div'); d.textContent=s??''; return d.innerHTML; }
const BLACKLIST=["chich","lon","cu","chem chep","dai","chay","cay lap","cac","cc","loz","lol","phang","du","dam","hiep","buom","ngu","oc cho","suc vat","may","tao","me"];
function stripDiacritics(s){ return s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/đ/gi,'d').toLowerCase(); }

// ============================================================
// KHỞI ĐỘNG
// ============================================================
async function boot(){
  const { data:{ session } } = await supabaseClient.auth.getSession();
  if(session){ await loadCurrentProfile(); view = currentProfile ? 'home_feed' : 'landing'; }
  await loadFields();
  render();
}
async function loadFields(){
  const { data } = await supabaseClient.from('fields').select('*').eq('active', true);
  fieldsCache = data || [];
}
async function loadCurrentProfile(){
  const { data:{ user } } = await supabaseClient.auth.getUser();
  currentAuthUser = user;
  if(!user){ currentProfile = null; return; }
  const { data } = await supabaseClient.from('users').select('*').eq('id', user.id).single();
  currentProfile = data;
}

// ============================================================
// AUTH
// ============================================================
async function doSignup(){
  const name=val('su-name'), nick=val('su-nick'), school=val('su-school'),
        gender=val('su-gender'), birth=val('su-birth'), email=val('su-email').toLowerCase(), pass=val('su-pass');
  const errEl=document.getElementById('su-err'); errEl.textContent='';
  if(!name||!nick||!school||!birth||!email||!pass){ errEl.textContent='Vui lòng điền đầy đủ thông tin.'; return; }
  if(!/\.edu(\.vn)?$/.test(email.split('@')[1]||'')){ errEl.textContent='Email phải có đuôi .edu hoặc .edu.vn.'; return; }
  if(BLACKLIST.some(w=>stripDiacritics(nick).includes(w))){ errEl.textContent='Biệt danh chứa từ ngữ không phù hợp.'; return; }
  const { error } = await supabaseClient.auth.signUp({
    email, password: pass,
    options:{ data:{ full_name:name, nickname:nick, school, gender, birth_year:Number(birth) } }
  });
  if(error){ errEl.textContent = error.message; return; }
  view='signup_success'; render();
}
async function doLogin(){
  const email=val('li-email').toLowerCase(), pass=val('li-pass');
  const errEl=document.getElementById('li-err');
  const { error } = await supabaseClient.auth.signInWithPassword({ email, password: pass });
  if(error){ errEl.textContent='Email hoặc mật khẩu của bạn không chính xác, vui lòng kiểm tra lại'; return; }
  await loadCurrentProfile(); view='home_feed'; render();
}
async function doLogout(){ await supabaseClient.auth.signOut(); currentProfile=null; view='landing'; render(); }
function val(id){ return document.getElementById(id).value.trim(); }

// ============================================================
// HỒ SƠ (seeker_profiles)
// ============================================================
async function myProfiles(){
  const { data } = await supabaseClient.from('seeker_profiles').select('*, fields(name)')
    .eq('user_id', currentAuthUser.id).order('created_at');
  return data || [];
}
async function createProfile(){
  const field_id=Number(val('np-field')), area=val('np-area'), level=Number(val('np-level')), intro=val('np-intro');
  const errEl=document.getElementById('np-err');
  if(!area||!intro){ errEl.textContent='Vui lòng điền đầy đủ khu vực và giới thiệu.'; return; }
  const { error } = await supabaseClient.from('seeker_profiles').insert({ user_id: currentAuthUser.id, field_id, area, level, intro });
  if(error){ errEl.textContent = error.message; return; }
  view='home_feed'; render();
}
async function deleteProfile(id){
  await supabaseClient.from('seeker_profiles').delete().eq('id', id);
  render();
}

// ============================================================
// MATCHING / KHÁM PHÁ
// ============================================================
async function feedFor(myProfile){
  const { data:blocked } = await supabaseClient.from('blocks').select('blocked_id').eq('blocker_id', currentAuthUser.id);
  const blockedIds = (blocked||[]).map(b=>b.blocked_id);
  let q = supabaseClient.from('seeker_profiles')
    .select('*, users_public(*)')
    .eq('field_id', myProfile.field_id)
    .neq('user_id', currentAuthUser.id);
  const { data } = await q;
  let list = (data||[]).filter(p => !blockedIds.includes(p.user_id));
  list.sort((a,b)=> (a.area===myProfile.area?0:1)-(b.area===myProfile.area?0:1) || b.level-a.level);
  return list;
}
async function myConnectionsMap(){
  const mine = await myProfiles();
  const ids = mine.map(p=>p.id);
  if(ids.length===0) return { conns:[], mineIds:ids };
  const { data } = await supabaseClient.from('connections').select('*')
    .or(`from_profile_id.in.(${ids.join(',')}),to_profile_id.in.(${ids.join(',')})`);
  return { conns:data||[], mineIds:ids };
}
async function requestConnect(fromProfileId, toProfileId){
  const { error } = await supabaseClient.rpc('request_connection', { p_from_profile: fromProfileId, p_to_profile: toProfileId });
  if(error) alert(error.message);
  render();
}
async function respondConnect(connId, status){
  if(status==='accepted'){
    if(!confirm('Xác nhận điều khoản (lớp 2): nền tảng đã áp dụng bảo vệ thông tin ở mức cao nhất có thể nhưng không cam kết tuyệt đối an toàn khi gặp mặt ngoài đời thực. Bạn đồng ý?')) return;
    await supabaseClient.from('terms_acceptances').insert({ user_id: currentAuthUser.id, layer:2, connection_id: connId });
  }
  const { error } = await supabaseClient.rpc('respond_connection', { p_connection_id: connId, p_status: status });
  if(error) alert(error.message);
  render();
}
async function cancelConnect(connId){
  await supabaseClient.rpc('cancel_connection', { p_connection_id: connId });
  render();
}
async function blockUser(userId){
  if(!confirm('Chặn người dùng này? Kết nối hiện tại (nếu có) sẽ tự động hủy.')) return;
  await supabaseClient.rpc('block_user', { p_blocked_id: userId });
  render();
}
async function reportUser(userId){
  const reason = prompt('Mô tả ngắn gọn hành vi vi phạm:');
  if(!reason) return;
  await supabaseClient.rpc('report_user', { p_reported_id: userId, p_reason: reason });
  alert('Đã gửi báo cáo, cảm ơn bạn.');
}

// ============================================================
// THÔNG BÁO
// ============================================================
async function loadNotifications(){
  const { data } = await supabaseClient.from('notifications').select('*')
    .eq('user_id', currentAuthUser.id).order('created_at', { ascending:false }).limit(30);
  notifCount = (data||[]).filter(n=>!n.is_read).length;
  return data || [];
}
async function markAllRead(){
  await supabaseClient.from('notifications').update({ is_read:true }).eq('user_id', currentAuthUser.id).eq('is_read', false);
  render();
}

// ============================================================
// ADMIN
// ============================================================
async function adminPendingUsers(){
  const { data } = await supabaseClient.from('users').select('*').eq('verify_status','pending').order('created_at');
  return data || [];
}
async function adminApprove(userId){ await supabaseClient.rpc('admin_set_verify',{p_user_id:userId,p_status:'verified'}); render(); }
async function adminReject(userId){ if(confirm('Từ chối và xóa tài khoản này?')){ await supabaseClient.rpc('admin_set_verify',{p_user_id:userId,p_status:'rejected'}); render(); } }
async function adminBan(userId){ if(confirm('Cấm vĩnh viễn tài khoản này?')){ await supabaseClient.rpc('admin_ban_permanently',{p_user_id:userId}); render(); } }
// ============================================================
// RENDER — ĐIỀU HƯỚNG MÀN HÌNH
// ============================================================
function go(v){ view=v; render(); }

async function render(){
  const app=document.getElementById('app');
  if(!currentProfile){
    if(view==='login') app.innerHTML = loginView();
    else if(view==='signup') app.innerHTML = signupView();
    else if(view==='signup_success') app.innerHTML = signupSuccessView();
    else app.innerHTML = landingView();
    return;
  }
  app.innerHTML = `<div class="wrap">Đang tải...</div>`;
  const notifs = await loadNotifications();
  let body = '';
  if(view==='my_profiles') body = await myProfilesView();
  else if(view==='new_profile') body = newProfileView();
  else if(view==='connections') body = await connectionsView();
  else if(view==='account') body = accountView();
  else if(view==='notifications') body = notificationsView(notifs);
  else if(view==='admin') body = await adminView();
  else body = await homeFeedView();
  app.innerHTML = topbar() + `<div class="wrap">${body}</div>`;
}

function landingView(){
  return `<div class="wrap landing">
    <div class="logo-tomato">🍅</div>
    <div class="brand">Nagari</div>
    <div class="tagline">Tìm bạn đồng hành học tập &amp; rèn luyện — cùng mục tiêu, cùng khu vực</div>
    <div class="btn-row">
      <button class="btn btn-login" onclick="go('login')">Đăng nhập</button>
      <button class="btn btn-signup" onclick="go('signup')">Đăng ký</button>
    </div>
    <div class="about"><h3>Nagari là gì?</h3>
      <p>Nền tảng giúp sinh viên có cùng mục tiêu học tập, kỹ năng, ngoại ngữ hoặc hoạt động thể chất rủi ro thấp tìm bạn đồng hành — xác thực bắt buộc bằng email sinh viên (.edu), thông tin cá nhân được bảo vệ theo từng lớp.</p>
    </div></div>`;
}
function loginView(){
  return `<div class="wrap">
    <button class="btn btn-ghost" onclick="go('landing')">← Trang chủ</button>
    <div class="card"><h2>Đăng nhập</h2><div class="sub">Dùng email sinh viên (.edu) của bạn</div>
      <label>Email .edu</label><input id="li-email" placeholder="ban@truong.edu.vn">
      <label>Mật khẩu <a href="#" style="float:right;font-size:12px;color:var(--tomato-dark);" onclick="alert('Dùng chức năng Quên mật khẩu của Supabase Auth (resetPasswordForEmail) — xem ghi chú cuối tài liệu.');return false;">Quên mật khẩu?</a></label>
      <input id="li-pass" type="password" placeholder="••••••••">
      <div id="li-err" class="err"></div>
      <div style="margin-top:18px;"><button class="btn btn-primary" onclick="doLogin()">Đăng nhập</button></div>
    </div></div>`;
}
function signupView(){
  return `<div class="wrap">
    <button class="btn btn-ghost" onclick="go('landing')">← Trang chủ</button>
    <div class="card"><h2>Đăng ký</h2>
      <div class="warn">⚠️ <b>Lưu ý quan trọng:</b> Hệ thống sẽ hậu kiểm thông tin trong 48 giờ. Họ tên giả, biệt danh phản cảm hoặc sai lệch sẽ khiến tài khoản bị loại.</div>
      <label>Họ và tên <span class="tag-private">Riêng tư</span></label><input id="su-name">
      <label>Biệt danh <span class="tag-public">Công khai</span></label><input id="su-nick">
      <label>Tên trường <span class="tag-private">Riêng tư</span></label><input id="su-school">
      <div class="field-row">
        <div><label>Giới tính <span class="tag-public">Công khai</span></label>
          <select id="su-gender"><option>Nam</option><option>Nữ</option><option>Khác</option></select></div>
        <div><label>Năm sinh <span class="tag-public">Công khai</span></label><input id="su-birth" type="number"></div>
      </div>
      <label>Email .edu/.edu.vn <span class="tag-private">Riêng tư</span></label><input id="su-email">
      <label>Mật khẩu</label><input id="su-pass" type="password">
      <div class="note">Hệ thống chỉ phân tích đuôi email công khai để xác thực, không truy cập dữ liệu nội bộ trường.</div>
      <div id="su-err" class="err"></div>
      <div style="margin-top:18px;"><button class="btn btn-primary" onclick="doSignup()">Đăng ký</button></div>
    </div></div>`;
}
function signupSuccessView(){
  return `<div class="wrap"><div class="card" style="text-align:center;">
    <div style="font-size:40px;">📩</div><h2>Kiểm tra email của bạn!</h2>
    <div class="sub">Supabase đã gửi email xác nhận tới hộp thư .edu của bạn. Bấm vào liên kết trong email để kích hoạt tài khoản, sau đó quay lại đăng nhập.</div>
    <button class="btn btn-primary" style="margin-top:14px;" onclick="go('login')">Đến trang đăng nhập</button>
  </div></div>`;
}
function verifiedBadge(u){
  return u.verify_status==='verified' ? `<span class="verified">✅ Đã xác minh</span>` : `<span class="pending">🛡️ đang chờ xác minh</span>`;
}
function topbar(){
  return `<nav class="topbar">
    <div class="nav-left" onclick="go('home_feed')">🍅 Nagari</div>
    <div class="nav-tabs">
      <button class="${view==='home_feed'?'active':''}" onclick="go('home_feed')">Khám phá</button>
      <button class="${view==='my_profiles'?'active':''}" onclick="go('my_profiles')">Hồ sơ</button>
      <button class="${view==='connections'?'active':''}" onclick="go('connections')">Kết nối</button>
      <button class="${view==='notifications'?'active':''}" onclick="go('notifications')">🔔${notifCount>0?` (${notifCount})`:''}</button>
      ${currentProfile.is_admin?`<button class="${view==='admin'?'active':''}" onclick="go('admin')">Admin</button>`:''}
    </div>
    <div class="avatar-circle" onclick="go('account')">🙂${notifCount>0?'<span class=\"badge-dot\"></span>':''}</div>
  </nav>`;
}

async function homeFeedView(){
  const mine = await myProfiles();
  if(mine.length===0){
    return `<h2 class="section-title" style="margin-top:8px;">Khám phá</h2>
    <div class="empty">Bạn chưa có hồ sơ nào. <a href="#" onclick="go('new_profile');return false;" style="color:var(--tomato-dark);">Tạo hồ sơ đầu tiên</a> để bắt đầu tìm kiếm.</div>`;
  }
  const { conns } = await myConnectionsMap();
  let html = `<h2 class="section-title" style="margin-top:8px;">Khám phá</h2><div class="sub">Ưu tiên: cùng mục tiêu → khu vực/lân cận → trình độ</div>`;
  for(const mp of mine){
    const others = await feedFor(mp);
    html += `<div style="margin-top:22px;font-weight:700;">Cho hồ sơ: ${mp.fields.name} <span style="font-weight:400;color:var(--ink-soft);">(${escapeHtml(mp.area)})</span></div>`;
    if(others.length===0){ html += `<div class="empty">Chưa có hồ sơ nào khớp. Hồ sơ của bạn vẫn hiển thị để người khác tìm thấy.</div>`; continue; }
    for(const p of others){
      const conn = conns.find(c => (c.from_profile_id===mp.id&&c.to_profile_id===p.id)||(c.from_profile_id===p.id&&c.to_profile_id===mp.id));
      html += await profileCard(p, mp, conn);
    }
  }
  return html;
}
async function profileCard(p, myProfile, conn){
  const u = p.users_public;
  let revealedInfo = '';
  if(conn && conn.status==='accepted'){
    const { data:full } = await supabaseClient.from('users').select('full_name,school,email').eq('id', p.user_id).single();
    if(full) revealedInfo = `<div class="pc-meta">Họ tên: ${escapeHtml(full.full_name)} · Trường: ${escapeHtml(full.school)} · Email: ${escapeHtml(full.email)}</div>`;
  }
  let actionHtml = '';
  if(!conn) actionHtml = `<button class="btn btn-primary" style="padding:9px 20px;font-size:13px;" onclick="requestConnect('${myProfile.id}','${p.id}')">Yêu cầu kết nối</button>`;
  else if(conn.status==='pending' && conn.from_profile_id===myProfile.id) actionHtml = `<span class="status-chip">Đã gửi yêu cầu kết nối</span>`;
  else if((conn.status==='pending'||conn.status==='waitlist') && conn.to_profile_id===myProfile.id)
    actionHtml = `<button class="btn btn-primary" style="padding:8px 16px;font-size:12.5px;" onclick="respondConnect('${conn.id}','accepted')">Accept</button> <button class="btn btn-ghost" style="padding:8px 16px;font-size:12.5px;" onclick="respondConnect('${conn.id}','waitlist')">Waitlist</button>`;
  else if(conn.status==='waitlist') actionHtml = `<span class="status-chip">Đã gửi yêu cầu kết nối</span>`;
  else if(conn.status==='accepted') actionHtml = `<button class="btn btn-ghost" style="padding:9px 18px;font-size:13px;" onclick="cancelConnect('${conn.id}')">Hủy kết nối</button> <span class="tag-public">Chat mở khóa</span>`;
  return `<div class="profile-card"><div class="avatar-big">🍅</div><div class="pc-body">
    <div class="pc-top">${escapeHtml(u.nickname)} ${verifiedBadge(u)}</div>
    <div class="pc-meta">${escapeHtml(p.area)} · <span class="stars">${'★'.repeat(p.level)}${'☆'.repeat(5-p.level)}</span> · ${u.gender}, sinh ${u.birth_year}</div>
    <div class="pc-intro">${escapeHtml(p.intro)}</div>
    ${revealedInfo || `<div class="private-note">Họ tên, trường, email — chỉ hiển thị khi cả hai đồng ý kết nối</div>`}
    <div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap;align-items:center;">${actionHtml}
      <button class="btn btn-ghost" style="padding:6px 12px;font-size:11.5px;" onclick="reportUser('${p.user_id}')">Báo cáo</button>
      <button class="btn btn-ghost" style="padding:6px 12px;font-size:11.5px;" onclick="blockUser('${p.user_id}')">Chặn</button>
    </div></div></div>`;
}

async function myProfilesView(){
  const mine = await myProfiles();
  let html = `<div style="display:flex;justify-content:space-between;align-items:center;margin-top:8px;">
    <h2 class="section-title" style="margin:0;">Hồ sơ của bạn</h2>
    <button class="btn btn-primary" style="padding:9px 18px;font-size:13px;" onclick="go('new_profile')">+ Tạo hồ sơ</button></div>`;
  if(mine.length===0){ html += `<div class="empty">Bạn chưa tạo hồ sơ nào. Mỗi lĩnh vực chỉ được 1 hồ sơ.</div>`; return html; }
  for(const p of mine){
    const daysLeft = Math.ceil((new Date(p.expires_at)-Date.now())/86400000);
    html += `<div class="card" style="margin-top:14px;">
      <div style="display:flex;justify-content:space-between;">
        <div><div style="font-weight:700;font-size:16px;">${p.fields.name}</div>
          <div class="pc-meta">${escapeHtml(p.area)} · <span class="stars">${'★'.repeat(p.level)}${'☆'.repeat(5-p.level)}</span></div></div>
        <button class="btn btn-ghost" style="padding:6px 14px;font-size:12px;" onclick="deleteProfile('${p.id}')">Xóa hồ sơ</button>
      </div>
      <div class="pc-intro" style="margin-top:8px;">${escapeHtml(p.intro)}</div>
      <div class="note">${daysLeft>0?`Còn ${daysLeft} ngày trước khi hết hạn.`:'Đã hết hạn.'}</div>
    </div>`;
  }
  return html;
}
function newProfileView(){
  const used = []; // sẽ tự lọc phía server qua UNIQUE constraint; ở đây liệt kê hết cho đơn giản
  return `<button class="btn btn-ghost" style="margin-top:8px;" onclick="go('my_profiles')">← Quay lại</button>
  <div class="card"><h2>Tạo hồ sơ mới</h2>
    <label>Lĩnh vực</label>
    <select id="np-field">${fieldsCache.map(f=>`<option value="${f.id}">${f.name}</option>`).join('')}</select>
    <label>Khu vực (quận)</label><input id="np-area" placeholder="vd: Quận 1">
    <label>Trình độ</label>
    <select id="np-level"><option value="1">1 sao</option><option value="2">2 sao</option><option value="3" selected>3 sao</option><option value="4">4 sao</option><option value="5">5 sao</option></select>
    <label>Giới thiệu</label><textarea id="np-intro"></textarea>
    <div id="np-err" class="err"></div>
    <div style="margin-top:16px;"><button class="btn btn-primary" onclick="createProfile()">Join</button></div>
    <div class="note">Hồ sơ sẽ được thêm vào kho hồ sơ ngầm để người khác tìm thấy bạn. Có thể xóa bất kỳ lúc nào ở mục "Hồ sơ của bạn".</div>
  </div>`;
}
async function connectionsView(){
  const { conns, mineIds } = await myConnectionsMap();
  let html = `<h2 class="section-title" style="margin-top:8px;">Kết nối</h2>`;
  if(conns.length===0){ html += `<div class="empty">Chưa có yêu cầu kết nối nào.</div>`; return html; }
  for(const c of conns){
    const otherProfileId = mineIds.includes(c.from_profile_id) ? c.to_profile_id : c.from_profile_id;
    const { data:otherProfile } = await supabaseClient.from('seeker_profiles').select('*, fields(name), users_public(*)').eq('id', otherProfileId).single();
    if(!otherProfile) continue;
    const isIncoming = mineIds.includes(c.to_profile_id);
    let actions = '';
    if(c.status==='accepted') actions = `<span class="tag-public">Chat mở khóa</span> <button class="btn btn-ghost" style="padding:7px 14px;font-size:12px;" onclick="cancelConnect('${c.id}')">Hủy</button>`;
    else if(isIncoming) actions = `<button class="btn btn-primary" style="padding:7px 14px;font-size:12px;" onclick="respondConnect('${c.id}','accepted')">Accept</button> <button class="btn btn-ghost" style="padding:7px 14px;font-size:12px;" onclick="respondConnect('${c.id}','waitlist')">Waitlist</button>`;
    else actions = `<span class="status-chip">Đang chờ phản hồi</span>`;
    html += `<div class="profile-card"><div class="avatar-big">🍅</div><div class="pc-body">
      <div class="pc-top">${escapeHtml(otherProfile.users_public.nickname)} ${verifiedBadge(otherProfile.users_public)}</div>
      <div class="pc-meta">${otherProfile.fields.name} · ${escapeHtml(otherProfile.area)}</div>
      <div style="margin-top:8px;">${actions}</div></div></div>`;
  }
  return html;
}
function notificationsView(notifs){
  let html = `<div style="display:flex;justify-content:space-between;align-items:center;margin-top:8px;">
    <h2 class="section-title" style="margin:0;">Thông báo</h2>
    <button class="btn btn-ghost" style="padding:7px 14px;font-size:12px;" onclick="markAllRead()">Đánh dấu đã đọc</button></div>`;
  if(notifs.length===0){ html += `<div class="empty">Chưa có thông báo nào.</div>`; return html; }
  notifs.forEach(n=>{
    html += `<div class="card" style="margin-top:10px;padding:14px 18px;${n.is_read?'':'border-color:var(--tomato);'}">
      <div style="font-size:14px;">${escapeHtml(n.message)}</div>
      <div class="note">${new Date(n.created_at).toLocaleString('vi-VN')}</div></div>`;
  });
  return html;
}
function accountView(){
  const u = currentProfile;
  return `<button class="btn btn-ghost" style="margin-top:8px;" onclick="go('home_feed')">← Quay lại</button>
  <div class="card"><h2>Thông tin cá nhân</h2>
    <div class="pc-meta">Biệt danh: ${escapeHtml(u.nickname)} (công khai)</div>
    <div class="pc-meta">Họ và tên: ${escapeHtml(u.full_name)} (không thể chỉnh sửa)</div>
    <div class="pc-meta">Trường: ${escapeHtml(u.school)} (không thể chỉnh sửa)</div>
    <div class="pc-meta">Email: ${escapeHtml(u.email)} (không thể chỉnh sửa)</div>
    <div class="pc-meta">Trạng thái: ${verifiedBadge(u)}</div></div>
  <div class="card"><div style="display:flex;gap:10px;">
    <button class="btn btn-ghost" onclick="doLogout()">Đăng xuất</button>
    <button class="btn btn-ghost" style="color:#B0342A;border-color:#E3B3B3;" onclick="deleteAccount()">Xóa tài khoản</button>
  </div></div>`;
}
async function deleteAccount(){
  if(!confirm('Xóa vĩnh viễn tài khoản?')) return;
  alert('Việc xóa auth.users cần quyền admin — xem ghi chú "Xóa tài khoản" ở cuối tài liệu (dùng Edge Function).');
}
async function adminView(){
  if(!currentProfile.is_admin) return `<div class="empty">Bạn không có quyền truy cập trang này.</div>`;
  const pending = await adminPendingUsers();
  let html = `<h2 class="section-title" style="margin-top:8px;">Admin — Hậu kiểm tài khoản</h2>`;
  if(pending.length===0){ html += `<div class="empty">Không có tài khoản nào chờ duyệt.</div>`; return html; }
  pending.forEach(u=>{
    html += `<div class="card" style="margin-top:12px;">
      <div style="font-weight:700;">${escapeHtml(u.full_name)} (@${escapeHtml(u.nickname)})</div>
      <div class="pc-meta">${escapeHtml(u.school)} · ${escapeHtml(u.email)}</div>
      <div style="margin-top:10px;display:flex;gap:8px;">
        <button class="btn btn-primary" style="padding:7px 14px;font-size:12px;" onclick="adminApprove('${u.id}')">Duyệt</button>
        <button class="btn btn-ghost" style="padding:7px 14px;font-size:12px;" onclick="adminReject('${u.id}')">Từ chối</button>
        <button class="btn btn-ghost" style="padding:7px 14px;font-size:12px;color:#B0342A;" onclick="adminBan('${u.id}')">Cấm</button>
      </div></div>`;
  });
  return html;
}

boot();