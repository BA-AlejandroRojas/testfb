(function(){
"use strict";

// ============================================================
// PAYOUT TABLES (single source of truth)
// ============================================================
const PAYOUTS = {
  2: { straight: 90, box: {"1,1": {name:"2-Way (Box)", odds:45}} },
  3: { straight: 900, box: {
        "1,1,1":{name:"6-Way (Box)",odds:150},
        "2,1":{name:"3-Way (Box)",odds:300}
      } },
  4: { straight: 9000, box: {
        "1,1,1,1":{name:"24-Way (Box)",odds:375},
        "2,1,1":{name:"12-Way (Box)",odds:750},
        "2,2":{name:"6-Way (Box)",odds:1500},
        "3,1":{name:"4-Way (Box)",odds:2250}
      } },
  5: { straight: 90000, box: {
        "1,1,1,1,1":{name:"120-Way (Box)",odds:750},
        "2,1,1,1":{name:"60-Way (Box)",odds:1500},
        "2,2,1":{name:"30-Way (Box)",odds:3000},
        "3,1,1":{name:"20-Way (Box)",odds:4500},
        "3,2":{name:"10-Way (Box)",odds:9000},
        "4,1":{name:"5-Way (Box)",odds:18000}
      } }
};

// Fireball payouts (only Straight + the single "all digits different" Box
// category per pick, per the official Fireball Odds table).
const FIREBALL_PAYOUTS = {
  2: { straight: 30, box: {
        "1,1": {name:"2-Way (Box)", odds:15}
      } },
  3: { straight: 240, box: {
        "1,1,1":{name:"6-Way (Box)",odds:40},
        "2,1":{name:"3-Way (Box)",odds:80}
      } },
  4: { straight: 1950, box: {
        "1,1,1,1":{name:"24-Way (Box)",odds:81.25},
        "2,1,1":{name:"12-Way (Box)",odds:162.5},
        "2,2":{name:"6-Way (Box)",odds:325},
        "3,1":{name:"4-Way (Box)",odds:487.5}
      } },
  5: { straight: 16300, box: {
        "1,1,1,1,1":{name:"120-Way (Box)",odds:135.8},
        "2,1,1,1":{name:"60-Way (Box)",odds:271.65},
        "2,2,1":{name:"30-Way (Box)",odds:543.3},
        "3,1,1":{name:"20-Way (Box)",odds:815},
        "3,2":{name:"10-Way (Box)",odds:1630},
        "4,1":{name:"5-Way (Box)",odds:3260}
      } }
};

function getPattern(str){
  const counts = {};
  for(const ch of str) counts[ch] = (counts[ch]||0) + 1;
  return Object.values(counts).sort((a,b)=>b-a).join(',');
}
function multisetEqual(a,b){
  return [...a].sort().join('') === [...b].sort().join('');
}
function boxCategory(len, str, table){
  const pattern = getPattern(str);
  const boxTable = table[len].box;
  return boxTable[pattern] || null;
}
function generateFireballCombos(winning, fireball){
  const combos = [];
  for(let i=0;i<winning.length;i++){
    const arr = winning.split('');
    arr[i] = fireball;
    combos.push({position:i+1, combo:arr.join('')});
  }
  return combos;
}

function roundMoney(n){
  // Guards against floating-point representation errors (e.g. 1.005*100 = 100.49999999999999)
  // so half-cent winnings round UP as expected (40.235 -> 40.24).
  return Math.round((n * 100) + 1e-7) / 100;
}

function evaluateTicket(t){
  const len = t.draw;
  const totalWager = t.bet;
  const baseWager = roundMoney(totalWager/2);
  const fireballWager = roundMoney(totalWager/2);

  let baseWin=false, baseCategory=null, baseOdds=0;
  if(t.playType==='straight'){
    baseWin = t.player === t.winning;
    if(baseWin){ baseCategory='Straight'; baseOdds=PAYOUTS[len].straight; }
  } else {
    baseWin = multisetEqual(t.player, t.winning);
    if(baseWin){
      const cat = boxCategory(len, t.winning, PAYOUTS);
      if(cat){ baseCategory=cat.name; baseOdds=cat.odds; } else { baseWin=false; }
    }
  }
  const baseWinnings = baseWin ? roundMoney(baseWager*baseOdds) : 0;

  const rawCombos = generateFireballCombos(t.winning, t.fireball);
  const seen = new Map();
  for(const c of rawCombos){ if(!seen.has(c.combo)) seen.set(c.combo, c.position); }
  const dedupedCombos = [...seen.keys()];

  let fireballWin=false, fireballCategory=null, fireballOdds=0, winningCombo=null;
  if(t.playType==='straight'){
    for(const c of dedupedCombos){
      if(t.player === c){ fireballWin=true; winningCombo=c; break; }
    }
    if(fireballWin){ fireballCategory='Straight'; fireballOdds=FIREBALL_PAYOUTS[len].straight; }
  } else {
    for(const c of dedupedCombos){
      if(multisetEqual(t.player, c)){
        const cat = boxCategory(len, c, FIREBALL_PAYOUTS);
        if(cat){ fireballWin=true; winningCombo=c; fireballCategory=cat.name; fireballOdds=cat.odds; break; }
      }
    }
  }
  const fireballWinnings = fireballWin ? roundMoney(fireballWager*fireballOdds) : 0;

  return {
    baseWager, fireballWager, baseWin, baseCategory, baseOdds, baseWinnings,
    rawCombos, dedupedCombos, fireballWin, fireballCategory, fireballOdds, fireballWinnings, winningCombo,
    totalWinnings: roundMoney(baseWinnings+fireballWinnings)
  };
}

// ============================================================
// TICKET STATE / RENDERING
// ============================================================
let ticketSeq = 0;
const tickets = new Map(); // id -> { calculated:boolean }
const PICK_LABELS = {2:'Pick 2', 3:'Pick 3', 4:'Pick 4', 5:'Pick 5'};

function fmtMoney(n){
  return '$' + Number(n).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function ticketTemplate(id, index){
  return `
  <div class="ticket" data-id="${id}">
    <div class="ticket-head">
      <div class="label"><span class="num">${index}</span> Sub-Ticket ${index}</div>
      <div class="ticket-head-actions">
        <button class="export-btn" data-action="export" title="Export as image" style="display:none;">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
        </button>
        <button class="remove-btn" data-action="remove" title="Remove sub-ticket">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
        </button>
      </div>
    </div>

    <div class="field-grid">
      <div class="field col-1">
        <label>Draw</label>
        <div class="select-wrap">
          <select data-field="draw">
            <option value="2">Pick 2</option>
            <option value="3" selected>Pick 3</option>
            <option value="4">Pick 4</option>
            <option value="5">Pick 5</option>
          </select>
        </div>
      </div>
      <div class="field col-1">
        <label>Play Type</label>
        <div class="select-wrap">
          <select data-field="playType">
            <option value="straight" selected>Straight</option>
            <option value="boxed">Boxed</option>
          </select>
        </div>
      </div>
      <div class="field col-1">
        <label>Player Combo</label>
        <div class="digit-group" data-field="player"></div>
        <div class="error-msg" data-err="player"></div>
      </div>
      <div class="field col-1">
        <label>Winning Combo</label>
        <div class="digit-group" data-field="winning"></div>
        <div class="error-msg" data-err="winning"></div>
      </div>
      <div class="field col-1">
        <label>Fireball</label>
        <div class="digit-group fireball-group" data-field="fireball"></div>
        <div class="error-msg" data-err="fireball"></div>
      </div>
      <div class="field col-1">
        <label>Bet Amount</label>
        <input type="number" data-field="bet" min="0.01" step="0.01" placeholder="1.00">
        <div class="error-msg" data-err="bet"></div>
      </div>
    </div>

    <div class="results" data-role="results"></div>
  </div>`;
}

function el(sel, root){ return (root||document).querySelector(sel); }
function els(sel, root){ return Array.from((root||document).querySelectorAll(sel)); }

function addTicket(){
  ticketSeq += 1;
  const id = 't' + ticketSeq;
  tickets.set(id, { calculated:false });
  const container = el('#tickets-container');
  const wrap = document.createElement('div');
  wrap.innerHTML = ticketTemplate(id, tickets.size);
  const node = wrap.firstElementChild;
  container.appendChild(node);
  buildDigitGroup(el('[data-field="player"]', node), 3, node, 'player');
  buildDigitGroup(el('[data-field="winning"]', node), 3, node, 'winning');
  buildDigitGroup(el('[data-field="fireball"]', node), 1, node, 'fireball');
  syncFireballBoxSize(node);
  bindTicketEvents(node, id);
  renumberTickets();
}

function renumberTickets(){
  const nodes = els('.ticket');
  nodes.forEach((node, i) => {
    el('.label', node).innerHTML = `<span class="num">${i+1}</span> Sub-Ticket ${i+1}`;
  });
}

// ============================================================
// DIGIT-BOX INPUT GROUP (OTP-style combo entry)
// ============================================================
function buildDigitGroup(container, length, node, fieldName){
  const oldValue = getDigitGroupValue(container);
  container.innerHTML = '';
  container.dataset.length = length;
  for(let i=0;i<length;i++){
    const box = document.createElement('input');
    box.type = 'text';
    box.className = 'digit-box';
    box.inputMode = 'numeric';
    box.autocomplete = 'off';
    box.maxLength = 1;
    box.dataset.index = i;
    container.appendChild(box);
  }
  if(oldValue){
    setDigitGroupValue(container, digitsOnly(oldValue, length));
  }
  wireDigitGroup(container, node, fieldName);
}

function getDigitGroupValue(container){
  return els('.digit-box', container).map(b => b.value).join('');
}

function setDigitGroupValue(container, value){
  const boxes = els('.digit-box', container);
  boxes.forEach((b, i) => { b.value = value[i] || ''; b.classList.toggle('filled', !!value[i]); });
}

const NEXT_FIELD_MAP = { player: 'winning', winning: 'fireball', fireball: 'bet' };

function focusNextField(node, fieldName){
  const nextField = NEXT_FIELD_MAP[fieldName];
  if(!nextField) return;
  if(nextField === 'bet'){
    const betInput = el('[data-field="bet"]', node);
    if(betInput) betInput.focus();
    return;
  }
  const nextBox = el(`[data-field="${nextField}"] .digit-box`, node);
  if(nextBox) nextBox.focus();
}

function wireDigitGroup(container, node, fieldName){
  const boxes = els('.digit-box', container);
  boxes.forEach((box, i) => {
    box.addEventListener('focus', () => box.select());
    box.addEventListener('click', () => box.select());
    box.addEventListener('input', () => {
      const digit = digitsOnly(box.value, 1);
      box.value = digit;
      box.classList.toggle('filled', !!digit);
      if(digit){
        if(boxes[i+1]) boxes[i+1].focus();
        else focusNextField(node, fieldName);
      }
      const id = node.getAttribute('data-id');
      maybeAutoRecalc(node, id);
    });
    box.addEventListener('keydown', (e) => {
      if(e.key === 'Backspace' && !box.value && boxes[i-1]){
        boxes[i-1].focus();
        boxes[i-1].value = '';
        boxes[i-1].classList.remove('filled');
        e.preventDefault();
      } else if(e.key === 'ArrowLeft' && boxes[i-1]){
        boxes[i-1].focus();
      } else if(e.key === 'ArrowRight' && boxes[i+1]){
        boxes[i+1].focus();
      }
    });
    box.addEventListener('paste', (e) => {
      e.preventDefault();
      const pasted = digitsOnly((e.clipboardData || window.clipboardData).getData('text'), boxes.length);
      setDigitGroupValue(container, pasted);
      const id = node.getAttribute('data-id');
      maybeAutoRecalc(node, id);
      if(pasted.length >= boxes.length){
        focusNextField(node, fieldName);
      } else {
        const nextEmpty = boxes[pasted.length];
        if(nextEmpty) nextEmpty.focus();
      }
    });
  });
}

function applyDrawConstraints(node){
  const draw = parseInt(el('[data-field="draw"]', node).value, 10);
  buildDigitGroup(el('[data-field="player"]', node), draw, node, 'player');
  buildDigitGroup(el('[data-field="winning"]', node), draw, node, 'winning');
  syncFireballBoxSize(node);
}

function syncFireballBoxSize(node){
  const playerBox = el('[data-field="player"] .digit-box', node);
  const fbBox = el('[data-field="fireball"] .digit-box', node);
  if(!playerBox || !fbBox) return;
  const w = playerBox.getBoundingClientRect().width;
  if(w > 0){
    fbBox.style.width = w + 'px';
    fbBox.style.height = w + 'px';
  }
}

function digitsOnly(str, maxLen){
  return str.replace(/\D/g, '').slice(0, maxLen);
}

function bindTicketEvents(node, id){
  el('[data-action="remove"]', node).addEventListener('click', () => {
    tickets.delete(id);
    node.remove();
    renumberTickets();
    recalcAll(false);
  });

  el('[data-field="draw"]', node).addEventListener('change', () => {
    applyDrawConstraints(node);
    maybeAutoRecalc(node, id);
  });
  el('[data-field="playType"]', node).addEventListener('change', () => maybeAutoRecalc(node, id));

  const betInput = el('[data-field="bet"]', node);
  betInput.addEventListener('input', () => maybeAutoRecalc(node, id));

  el('[data-action="export"]', node).addEventListener('click', () => exportTicketAsImage(node, id));

  // copy button delegation happens after render in renderResults
}

function exportTicketAsImage(node, id){
  if(typeof html2canvas === 'undefined'){
    alert('Export is unavailable: html2canvas failed to load (check your internet connection).');
    return;
  }
  const btn = el('[data-action="export"]', node);
  const removeBtn = el('[data-action="remove"]', node);
  btn.classList.add('exporting');
  const prevBtnDisplay = btn.style.display;
  const prevRemoveDisplay = removeBtn.style.display;
  btn.style.display = 'none';
  removeBtn.style.display = 'none';

  const theme = document.documentElement.getAttribute('data-theme') === 'light' ? '#F3F2F8' : '#1A1E26';

  html2canvas(node, { backgroundColor: theme, scale: 2 }).then(canvas => {
    btn.style.display = prevBtnDisplay;
    removeBtn.style.display = prevRemoveDisplay;
    btn.classList.remove('exporting');
    const link = document.createElement('a');
    const label = node.querySelector('.label').textContent.trim().replace(/\s+/g, '-').toLowerCase();
    link.download = `betanything-lotto-${label}-${Date.now()}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
  }).catch(() => {
    btn.style.display = prevBtnDisplay;
    removeBtn.style.display = prevRemoveDisplay;
    btn.classList.remove('exporting');
    alert('Export failed. Please try again.');
  });
}

function maybeAutoRecalc(node, id){
  const state = tickets.get(id);
  if(state && state.calculated){
    calculateTicket(node, id);
    updateSummary();
  }
}

// ============================================================
// VALIDATION
// ============================================================
function clearErrors(node){
  els('.field', node).forEach(f => f.classList.remove('has-error'));
  els('[data-err]', node).forEach(e => e.textContent = '');
}
function setError(node, fieldName, message){
  const target = el(`[data-field="${fieldName}"]`, node);
  const field = target.closest('.field');
  field.classList.add('has-error');
  el(`[data-err="${fieldName}"]`, node).textContent = message;
}

function readTicket(node){
  return {
    draw: parseInt(el('[data-field="draw"]', node).value, 10),
    playType: el('[data-field="playType"]', node).value,
    player: getDigitGroupValue(el('[data-field="player"]', node)),
    winning: getDigitGroupValue(el('[data-field="winning"]', node)),
    fireball: getDigitGroupValue(el('[data-field="fireball"]', node)),
    bet: parseFloat(el('[data-field="bet"]', node).value)
  };
}

function validateTicket(node, t){
  clearErrors(node);
  let ok = true;
  if(t.player.length !== t.draw || !/^\d+$/.test(t.player)){
    setError(node, 'player', `Enter exactly ${t.draw} digit${t.draw>1?'s':''}.`);
    ok = false;
  }
  if(t.winning.length !== t.draw || !/^\d+$/.test(t.winning)){
    setError(node, 'winning', `Enter exactly ${t.draw} digit${t.draw>1?'s':''}.`);
    ok = false;
  }
  if(t.fireball.length !== 1 || !/^\d$/.test(t.fireball)){
    setError(node, 'fireball', 'Enter one digit (0-9).');
    ok = false;
  }
  if(!(t.bet > 0) || isNaN(t.bet)){
    setError(node, 'bet', 'Enter a valid amount greater than $0.');
    ok = false;
  }
  return ok;
}

// ============================================================
// CANNED RESPONSE
// ============================================================
function drawName(len){ return PICK_LABELS[len]; }
function playTypeName(pt){ return pt === 'straight' ? 'Straight' : 'Boxed'; }

function buildResponse(t, r){
  const draw = drawName(t.draw);
  const pt = playTypeName(t.playType);
  const lines = [];

  lines.push(`Thank you for reaching out about your ${draw} ${pt} play.`);
  lines.push('');
  lines.push('TICKET DETAILS');
  lines.push(`Player Combination: ${t.player}`);
  lines.push(`Winning Combination: ${t.winning}`);
  lines.push(`Fireball Number: ${t.fireball}`);
  lines.push(`Total Wager: ${fmtMoney(t.bet)} (Base ${fmtMoney(r.baseWager)} / Fireball ${fmtMoney(r.fireballWager)})`);
  lines.push('');

  lines.push('BASE TICKET');
  if(r.baseWin){
    lines.push(`Result: WIN \u2014 ${t.player} matched the winning combination ${t.winning} as ${r.baseCategory}.`);
    lines.push(`Odds Used: ${r.baseOdds} to 1 on the ${fmtMoney(r.baseWager)} Base wager.`);
    lines.push(`Base Winnings: ${fmtMoney(r.baseWinnings)}`);
  } else {
    lines.push(`Result: No win \u2014 ${t.player} did not match the winning combination ${t.winning}.`);
    lines.push(`Base Winnings: $0.00`);
  }
  lines.push('');

  lines.push('FIREBALL');
  if(r.fireballWin){
    let posNote = '';
    if(t.playType === 'straight'){
      const posEntry = r.rawCombos.find(c => c.combo === r.winningCombo);
      if(posEntry) posNote = ` (Fireball ${t.fireball} substituted into position ${posEntry.position})`;
    }
    lines.push(`Result: WIN \u2014 ${t.player} matched the Fireball combination ${r.winningCombo}${posNote} as ${r.fireballCategory}.`);
    lines.push(`Odds Used: ${r.fireballOdds} to 1 on the ${fmtMoney(r.fireballWager)} Fireball wager.`);
    lines.push(`Fireball Winnings: ${fmtMoney(r.fireballWinnings)}`);
  } else {
    lines.push(`Result: No win \u2014 none of the Fireball combinations generated from the Fireball number ${t.fireball} matched ${t.player}.`);
    lines.push(`Fireball Winnings: $0.00`);
  }
  lines.push('');

  lines.push(`TOTAL WINNINGS: ${fmtMoney(r.totalWinnings)}`);
  lines.push('');
  lines.push(r.totalWinnings > 0
    ? 'Congratulations on your win!'
    : 'Unfortunately, this play was not a winner this time. Thank you for playing!');

  return lines.join('\n');
}

// ============================================================
// RESULTS RENDERING
// ============================================================
function comboWithHighlight(combo, changedIndex){
  return [...combo].map((ch, i) => i === changedIndex ? `<span class="fb-digit-hl">${ch}</span>` : ch).join('');
}

function fbTableRows(t, r){
  return r.rawCombos.map(c => {
    const isWinningCombo = r.fireballWin && c.combo === r.winningCombo;
    return `<tr class="${isWinningCombo ? 'matched' : ''}"><td class="pos">Position ${c.position}</td><td>${comboWithHighlight(c.combo, c.position-1)}</td></tr>`;
  }).join('');
}

const ROW_ICONS = {
  result: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/></svg>',
  odds: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="19" y1="5" x2="5" y2="19"/><circle cx="6.5" cy="6.5" r="2.5"/><circle cx="17.5" cy="17.5" r="2.5"/></svg>',
  coin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M9 12h6M12 9v6" stroke-linecap="round"/></svg>'
};
function rk(icon, label){
  return `<span class="k"><span class="k-icon">${ROW_ICONS[icon]}</span>${label}</span>`;
}

const FLAME_ICON = '<svg class="banner-flame" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2c1 3-2 4-2 7a3 3 0 0 0 6 0c1.5 1.5 2 3.5 2 5a6 6 0 0 1-12 0c0-4 3-5 3-8 0-1.5 1-3 3-4z"/></svg>';

function renderResults(node, t, r, animate){
  const box = el('[data-role="results"]', node);

  let bannerClass = 'lose', bannerText = 'No Win';
  if(r.baseWin && r.fireballWin){ bannerClass = 'win-both'; bannerText = 'Base Win + Fireball Win'; }
  else if(r.baseWin){ bannerClass = 'win-base'; bannerText = 'Base Win'; }
  else if(r.fireballWin){ bannerClass = 'win-fireball'; bannerText = 'Fireball Win'; }
  const isWin = bannerClass !== 'lose';

  const dimBase = !r.baseWin && r.fireballWin;
  const dimFireball = !r.fireballWin && r.baseWin;

  const responseText = buildResponse(t, r);

  const baseWinDisplay = animate ? '$0.00' : fmtMoney(r.baseWinnings);
  const fbWinDisplay = animate ? '$0.00' : fmtMoney(r.fireballWinnings);
  const totalWinDisplay = animate ? '$0.00' : fmtMoney(r.totalWinnings);

  box.innerHTML = `
    <div class="result-banner ${bannerClass}">${isWin ? FLAME_ICON : ''}${bannerText}</div>
    <div class="cards-row">
      <div class="rcard ${dimBase ? 'lost' : ''}">
        <h4>Base Ticket</h4>
        <div class="rline">${rk('result','Result')}<span class="v ${r.baseWin?'win':'lose'}">${r.baseWin?'WIN':'LOSS'}</span></div>
        <div class="rline"><span class="k">Base Wager</span><span class="v">${fmtMoney(r.baseWager)}</span></div>
        <div class="rline"><span class="k">Combination</span><span class="v mono">${r.baseCategory ? t.winning : '&mdash;'}</span></div>
        <div class="rline"><span class="k">Category</span><span class="v">${r.baseCategory || '&mdash;'}</span></div>
        <div class="rline">${rk('odds','Payout Odds')}<span class="v">${r.baseOdds ? r.baseOdds + ' to 1' : '&mdash;'}</span></div>
        <div class="rline">${rk('coin','Base Winnings')}<span class="v gold" data-countup="${r.baseWinnings}">${baseWinDisplay}</span></div>
      </div>
      <div class="rcard fireball-card ${dimFireball ? 'lost' : ''}">
        <h4>Fireball</h4>
        <div class="rline"><span class="k">Fireball Number</span><span class="v mono">${t.fireball}</span></div>
        <div class="rline">${rk('result','Result')}<span class="v ${r.fireballWin?'win':'lose'}">${r.fireballWin?'WIN':'LOSS'}</span></div>
        <div class="rline"><span class="k">Winning Combo</span><span class="v mono">${r.winningCombo || '&mdash;'}</span></div>
        <div class="rline"><span class="k">Fireball Wager</span><span class="v">${fmtMoney(r.fireballWager)}</span></div>
        <div class="rline"><span class="k">Category</span><span class="v">${r.fireballCategory || '&mdash;'}</span></div>
        <div class="rline">${rk('odds','Payout Odds')}<span class="v">${r.fireballOdds ? r.fireballOdds + ' to 1' : '&mdash;'}</span></div>
        <div class="rline">${rk('coin','Fireball Winnings')}<span class="v gold" data-countup="${r.fireballWinnings}">${fbWinDisplay}</span></div>
        <div class="fb-breakdown-label">Fireball Combinations</div>
        <table class="fb-table">
          <thead><tr><th>Position</th><th>Combination</th></tr></thead>
          <tbody>${fbTableRows(t, r)}</tbody>
        </table>
      </div>
    </div>

    <div class="total-strip">
      <div class="tstat"><div class="tk">Total Wager</div><div class="tv">${fmtMoney(t.bet)}</div></div>
      <div class="tstat"><div class="tk">Total Winnings</div><div class="tv ${r.totalWinnings===0?'zero':''}" data-countup="${r.totalWinnings}">${totalWinDisplay}</div></div>
    </div>

    <div class="response-card">
      <h4>
        <span class="rc-label">
          <span class="rc-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
          </span>
          Canned Response
        </span>
        <button class="btn-copy" data-action="copy">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
          Copy Response
        </button>
      </h4>
      <div class="response-text" data-role="response-text">${responseText}</div>
    </div>
  `;

  box.classList.add('show');

  const exportBtn = el('[data-action="export"]', node);
  if(exportBtn) exportBtn.style.display = 'flex';

  if(animate){
    animateCountUps(box);
  }

  el('[data-action="copy"]', box).addEventListener('click', (e) => {
    const btn = e.currentTarget;
    const text = el('[data-role="response-text"]', box).textContent;
    navigator.clipboard.writeText(text).then(() => {
      btn.classList.add('copied');
      const label = btn.childNodes[btn.childNodes.length-1];
      const original = btn.innerHTML;
      btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg> Copied`;
      setTimeout(() => { btn.classList.remove('copied'); btn.innerHTML = original; }, 1600);
    }).catch(() => {});
  });
}

// ============================================================
// COUNT-UP ANIMATION
// ============================================================
function animateCountUp(target, finalValue, duration){
  const start = performance.now();
  function step(now){
    const progress = Math.min((now - start) / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3);
    target.textContent = fmtMoney(finalValue * eased);
    if(progress < 1) requestAnimationFrame(step);
    else target.textContent = fmtMoney(finalValue);
  }
  requestAnimationFrame(step);
}
function animateCountUps(box){
  els('[data-countup]', box).forEach(elm => {
    const value = parseFloat(elm.getAttribute('data-countup'));
    animateCountUp(elm, value, 650);
  });
}

function calculateTicket(node, id, animate){
  const t = readTicket(node);
  if(!validateTicket(node, t)){
    el('[data-role="results"]', node).classList.remove('show');
    node.classList.remove('state-win', 'state-loss');
    tickets.get(id).calculated = false;
    return null;
  }
  const r = evaluateTicket(t);
  renderResults(node, t, r, animate);
  node.classList.remove('state-win', 'state-loss');
  node.classList.add((r.baseWin || r.fireballWin) ? 'state-win' : 'state-loss');
  tickets.get(id).calculated = true;
  tickets.get(id).lastResult = r;
  tickets.get(id).lastTicket = t;
  return r;
}

function recalcAll(scrollCheck){
  const nodes = els('.ticket');
  let allValid = true;
  nodes.forEach(node => {
    const id = node.getAttribute('data-id');
    const r = calculateTicket(node, id, true);
    if(r === null) allValid = false;
  });
  updateSummary();
  return allValid;
}

function updateSummary(){
  const nodes = els('.ticket');
  let totalWager=0, totalBaseWager=0, totalFbWager=0, totalBaseWin=0, totalFbWin=0, count=0;
  nodes.forEach(node => {
    const id = node.getAttribute('data-id');
    const state = tickets.get(id);
    if(state && state.calculated && state.lastResult){
      const r = state.lastResult, t = state.lastTicket;
      totalWager += t.bet;
      totalBaseWager += r.baseWager;
      totalFbWager += r.fireballWager;
      totalBaseWin += r.baseWinnings;
      totalFbWin += r.fireballWinnings;
      count += 1;
    }
  });
  const summary = el('#summary');
  if(count === 0){ summary.classList.remove('show'); return; }
  summary.classList.add('show');
  el('#sumTotalWager').textContent = fmtMoney(totalWager);
  el('#sumBaseWager').textContent = fmtMoney(totalBaseWager);
  el('#sumFbWager').textContent = fmtMoney(totalFbWager);
  el('#sumBaseWin').textContent = fmtMoney(totalBaseWin);
  el('#sumFbWin').textContent = fmtMoney(totalFbWin);
  el('#sumTotalWin').textContent = fmtMoney(roundMoney(totalBaseWin + totalFbWin));
  el('#sumCount').textContent = String(count);
}

// ============================================================
// TOOLBAR ACTIONS
// ============================================================
el('#addTicketBtn').addEventListener('click', () => addTicket());

el('#calcBtn').addEventListener('click', () => {
  if(tickets.size === 0) addTicket();
  recalcAll(true);
});

let clearConfirming = false;
let clearTimeout = null;
el('#clearAllBtn').addEventListener('click', function(){
  if(!clearConfirming){
    clearConfirming = true;
    this.textContent = 'Confirm Clear All?';
    this.classList.add('confirming');
    clearTimeout = setTimeout(() => {
      clearConfirming = false;
      this.textContent = 'Clear All';
      this.classList.remove('confirming');
    }, 3000);
    return;
  }
  clearTimeout && window.clearTimeout(clearTimeout);
  clearConfirming = false;
  this.textContent = 'Clear All';
  this.classList.remove('confirming');

  tickets.clear();
  ticketSeq = 0;
  el('#tickets-container').innerHTML = '';
  el('#summary').classList.remove('show');
  addTicket();
});

// ============================================================
// THEME TOGGLE
// ============================================================
function applyTheme(theme){
  document.documentElement.setAttribute('data-theme', theme);
  try{ localStorage.setItem('ba-lotto-theme', theme); }catch(e){}
}
function initTheme(){
  let saved = null;
  try{ saved = localStorage.getItem('ba-lotto-theme'); }catch(e){}
  const prefersLight = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches;
  applyTheme(saved || (prefersLight ? 'light' : 'dark'));
}
el('#themeToggle').addEventListener('click', () => {
  const current = document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
  applyTheme(current === 'light' ? 'dark' : 'light');
});
initTheme();

// ============================================================
// TABS
// ============================================================
els('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const target = btn.getAttribute('data-tab');
    els('.tab-btn').forEach(b => b.classList.toggle('active', b === btn));
    els('.tab-panel').forEach(p => p.classList.toggle('active', p.getAttribute('data-panel') === target));
  });
});

// ============================================================
// PAYLINES TAB
// ============================================================
const PAYLINES_BASE_DATA = [
  {
    pick: 'Pick 2',
    note: 'Two-digit numbers, 00\u201399.',
    rows: [
      {type:'Straight', example:'12', range:'Any 2-digit number from 00 to 99 (exact order).', odds:90, straight:true},
      {type:'2-Way (Box)', example:'12', range:'Any 2-digit number with all different digits (any order).', odds:45}
    ]
  },
  {
    pick: 'Pick 3',
    note: 'Three-digit numbers, 000\u2013999.',
    rows: [
      {type:'Straight', example:'123', range:'Any 3-digit number from 000 to 999 (exact order).', odds:900, straight:true},
      {type:'6-Way (Box)', example:'123', range:'Any 3-digit number with all different digits (any order).', odds:150},
      {type:'3-Way (Box)', example:'112', range:'Any 3-digit number with 2 digits the same (any order).', odds:300}
    ]
  },
  {
    pick: 'Pick 4',
    note: 'Four-digit numbers, 0000\u20139999.',
    rows: [
      {type:'Straight', example:'1234', range:'Any 4-digit number from 0000 to 9999 (exact order).', odds:9000, straight:true},
      {type:'24-Way (Box)', example:'1234', range:'All digits different (any order).', odds:375},
      {type:'12-Way (Box)', example:'1123', range:'2 digits the same (any order).', odds:750},
      {type:'6-Way (Box)', example:'1122', range:'2 sets of 2 digits the same (any order).', odds:1500},
      {type:'4-Way (Box)', example:'1112', range:'3 digits the same (any order).', odds:2250}
    ]
  },
  {
    pick: 'Pick 5',
    note: 'Five-digit numbers, 00000\u201399999.',
    rows: [
      {type:'Straight', example:'12345', range:'Any 5-digit number from 00000 to 99999 (exact order).', odds:90000, straight:true},
      {type:'120-Way (Box)', example:'12345', range:'All digits different (any order).', odds:750},
      {type:'60-Way (Box)', example:'11234', range:'2 digits the same (any order).', odds:1500},
      {type:'30-Way (Box)', example:'11223', range:'2 sets of 2 digits the same (any order).', odds:3000},
      {type:'20-Way (Box)', example:'11123', range:'3 digits the same (any order).', odds:4500},
      {type:'10-Way (Box)', example:'11222', range:'2 sets of 2 and 3 digits the same (any order).', odds:9000},
      {type:'5-Way (Box)', example:'11112', range:'4 digits the same (any order).', odds:18000}
    ]
  }
];

const PAYLINES_FIREBALL_DATA = [
  {
    pick: 'Pick 2',
    note: 'Two-digit numbers, 00\u201399.',
    rows: [
      {type:'Straight', example:'12', range:'Any 2-digit number from 00 to 99 (exact order).', odds:30, straight:true},
      {type:'2-Way (Box)', example:'12', range:'Any 2-digit number with all different digits (any order).', odds:15}
    ]
  },
  {
    pick: 'Pick 3',
    note: 'Three-digit numbers, 000\u2013999.',
    rows: [
      {type:'Straight', example:'123', range:'Any 3-digit number from 000 to 999 (exact order).', odds:240, straight:true},
      {type:'6-Way (Box)', example:'123', range:'Any 3-digit number with all different digits (any order).', odds:40},
      {type:'3-Way (Box)', example:'112', range:'Any 3-digit number with 2 digits the same (any order).', odds:80}
    ]
  },
  {
    pick: 'Pick 4',
    note: 'Four-digit numbers, 0000\u20139999.',
    rows: [
      {type:'Straight', example:'1234', range:'Any 4-digit number from 0000 to 9999 (exact order).', odds:1950, straight:true},
      {type:'24-Way (Box)', example:'1234', range:'All digits different (any order).', odds:81.25},
      {type:'12-Way (Box)', example:'1123', range:'2 digits the same (any order).', odds:162.5},
      {type:'6-Way (Box)', example:'1122', range:'2 sets of 2 digits the same (any order).', odds:325},
      {type:'4-Way (Box)', example:'1112', range:'3 digits the same (any order).', odds:487.5}
    ]
  },
  {
    pick: 'Pick 5',
    note: 'Five-digit numbers, 00000\u201399999.',
    rows: [
      {type:'Straight', example:'12345', range:'Any 5-digit number from 00000 to 99999 (exact order).', odds:16300, straight:true},
      {type:'120-Way (Box)', example:'12345', range:'All digits different (any order).', odds:135.8},
      {type:'60-Way (Box)', example:'11234', range:'2 digits the same (any order).', odds:271.65},
      {type:'30-Way (Box)', example:'11223', range:'2 sets of 2 digits the same (any order).', odds:543.3},
      {type:'20-Way (Box)', example:'11123', range:'3 digits the same (any order).', odds:815},
      {type:'10-Way (Box)', example:'11222', range:'2 sets of 2 and 3 digits the same (any order).', odds:1630},
      {type:'5-Way (Box)', example:'11112', range:'4 digits the same (any order).', odds:3260}
    ]
  }
];

function fmtOdds(n){
  return n.toLocaleString('en-US', {minimumFractionDigits: (n % 1 !== 0) ? 2 : 0, maximumFractionDigits: 2});
}

function paylinesGroupHTML(group, payoutLabel){
  return `
    <div class="paylines-group">
      <h3><span class="pick-tag">${group.pick}</span></h3>
      <div class="group-note">${group.note}</div>
      <div class="table-scroll">
        <table class="paylines-table">
          <thead>
            <tr><th>Combination Type</th><th>Example</th><th>Rule</th><th>${payoutLabel}</th></tr>
          </thead>
          <tbody>
            ${group.rows.map(row => `
              <tr class="${row.straight ? 'pl-straight' : ''}">
                <td class="pl-type">${row.type}</td>
                <td class="pl-example">${row.example}</td>
                <td>${row.range}</td>
                <td class="pl-odds">${fmtOdds(row.odds)} to 1</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>`;
}

function renderPaylines(){
  const container = el('#paylines-container');
  container.innerHTML = `
    <div class="paylines-view active" data-view="base">
      ${PAYLINES_BASE_DATA.map(g => paylinesGroupHTML(g, 'Base Payout')).join('')}
    </div>
    <div class="paylines-view" data-view="fireball">
      ${PAYLINES_FIREBALL_DATA.map(g => paylinesGroupHTML(g, 'Fireball Payout')).join('')}
    </div>
  `;
}
renderPaylines();

els('.subtab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const target = btn.getAttribute('data-subtab');
    els('.subtab-btn').forEach(b => b.classList.toggle('active', b === btn));
    els('.paylines-view').forEach(v => v.classList.toggle('active', v.getAttribute('data-view') === target));
  });
});

// ============================================================
// AMBIENT EMBERS (subtle background flair)
// ============================================================
(function initAppEmbers(){
  const container = el('#appEmbers');
  if(!container) return;
  const COUNT = 10;
  for(let i=0;i<COUNT;i++){
    const ember = document.createElement('div');
    ember.className = 'app-ember';
    const size = 2 + Math.random() * 3;
    const left = Math.random() * 100;
    const duration = 14 + Math.random() * 12;
    const delay = Math.random() * 18;
    const drift = (Math.random() * 40 - 20) + 'px';
    ember.style.width = size + 'px';
    ember.style.height = size + 'px';
    ember.style.left = left + '%';
    ember.style.setProperty('--drift', drift);
    ember.style.animationDuration = duration + 's, ' + (2 + Math.random()*2) + 's';
    ember.style.animationDelay = delay + 's, 0s';
    container.appendChild(ember);
  }
})();

// ============================================================
// INIT
// ============================================================
addTicket();

let resizeTimer = null;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    els('.ticket').forEach(node => syncFireballBoxSize(node));
  }, 120);
});

})();
