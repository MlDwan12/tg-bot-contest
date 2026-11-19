/**
 * Общий виджет прогресса рассылки (Bot API 10.4, sendWidget is_shared).
 * Данные — public_data, JSON MailingProgressData; обновляет бэк через
 * editSharedWidgetData. Лимиты Telegram: HTML ≤32 КБ (≤4 КБ в zlib),
 * сеть внутри виджета запрещена — всё инлайн.
 */
export type MailingProgressData = {
  q: number; // в очереди (получатели с telegramId)
  s: number; // доставлено
  b: number; // заблокировали бота
  e: number; // прочие ошибки
  k: number; // пропущено (нет telegramId)
  st: string; // статус mailing_jobs
  r: number; // ревизия — старые данные отбрасываются
};

export const MAILING_PROGRESS_WIDGET_HTML = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
body{margin:0;padding:12px 14px;font-family:system-ui,sans-serif;font-size:14px;
color:var(--tg-theme-text-color,#fff);background:var(--tg-theme-bg-color,#1c1c1e)}
.h{display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;font-weight:600}
.st{font-size:12px;font-weight:500;padding:2px 8px;border-radius:999px;
background:var(--tg-theme-secondary-bg-color,#2c2c2e);color:var(--tg-theme-hint-color,#999)}
.st.ok{color:#34c759}.st.err{color:#ff9f0a}.st.bad{color:#ff453a}
.bar{height:8px;border-radius:4px;overflow:hidden;background:var(--tg-theme-secondary-bg-color,#2c2c2e)}
.fill{height:100%;width:0;background:var(--tg-theme-button-color,#7939e4);transition:width .4s}
.g{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:12px}
.c{padding:8px;border-radius:10px;background:var(--tg-theme-secondary-bg-color,#2c2c2e)}
.n{font-size:18px;font-weight:700}.l{font-size:11px;color:var(--tg-theme-hint-color,#999)}
.f{margin-top:10px;font-size:12px;color:var(--tg-theme-hint-color,#999)}
</style></head><body>
<div class="h"><span>📬 Рассылка</span><span id="st" class="st">—</span></div>
<div class="bar"><div id="fill" class="fill"></div></div>
<div class="g">
<div class="c"><div id="s" class="n">0</div><div class="l">доставлено</div></div>
<div class="c"><div id="b" class="n">0</div><div class="l">заблокировали</div></div>
<div class="c"><div id="e" class="n">0</div><div class="l">ошибки</div></div>
</div>
<div id="f" class="f"></div>
<script>
var W=window.TelegramWidget,last=-1;
var ST={processing:['идёт',''],completed:['завершена','ok'],completed_with_errors:['завершена с ошибками','err'],failed:['ошибка','bad'],cancelled:['отменена','bad']};
function $(i){return document.getElementById(i)}
function fmt(n){return Number(n||0).toLocaleString('ru-RU')}
function render(){
var d=null;try{d=JSON.parse(W&&W.publicData)}catch(x){}
if(!d||d.r<last)return;last=d.r;
var done=d.s+d.b+d.e,p=d.q?Math.min(100,Math.round(done*100/d.q)):100;
var st=ST[d.st]||[d.st,''];
$('st').textContent=st[0];$('st').className='st '+st[1];
$('fill').style.width=p+'%';
$('s').textContent=fmt(d.s);$('b').textContent=fmt(d.b);$('e').textContent=fmt(d.e);
$('f').textContent=fmt(done)+' из '+fmt(d.q)+' · '+p+'%'+(d.k?' · пропущено '+fmt(d.k):'');
}
if(W){W.onEvent('publicDataChanged',render);W.watchPublicData()}
render();if(W&&W.ready)W.ready();
</script></body></html>`;
