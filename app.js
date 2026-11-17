import { auth, googleProvider, db } from "./firebase.js";

import {
  signInWithPopup,
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/13.3.0/firebase-auth.js";

import {
  doc,
  getDoc,
  setDoc
} from "https://www.gstatic.com/firebasejs/13.3.0/firebase-firestore.js";
const DB_KEY = "luar_finanzas_v1";
const CATEGORIES = {
  expense: ["Alimentación","Transporte","Vivienda","Servicios","Salud","Educación","Entretenimiento","Compras","Deudas","Otros"],
  income: ["Salario","Negocio","Trabajos adicionales","Regalos","Inversiones","Otros"]
};
const $ = id => document.getElementById(id);
const today = () => new Date().toISOString().slice(0,10);
const localToday = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
};
const monthKey = date => String(date || "").slice(0,7);
const defaultData = () => ({
  settings:{currency:"DOP"},
  accounts:[{id:crypto.randomUUID(),name:"Efectivo",type:"Efectivo",opening:0,currency:"DOP"}],
  transactions:[],
  budgets:[],
  debts:[],
  recurring:[]
});
const legacyData = loadData();
let data = defaultData();
let currentUser = null;
let gmailConnected = false;
let calendarDate = new Date();
let calendarSelectedDate = localToday();

function loadData(){
  try {
    const saved=localStorage.getItem(DB_KEY);
    if(!saved)return defaultData();
    const parsed=JSON.parse(saved);
    return {
      ...defaultData(),
      ...parsed,
      debts:Array.isArray(parsed.debts)?parsed.debts:[],
      recurring:Array.isArray(parsed.recurring)?parsed.recurring:[]
    };
  } catch(e){ return defaultData(); }
}
function saveData(){
  if(!currentUser) return;

  const userKey = DB_KEY + "_" + currentUser.uid;

  localStorage.setItem(userKey,JSON.stringify(data));
  renderAll();

  setDoc(doc(db,"users",currentUser.uid),{
    data: data,
    updatedAt: new Date().toISOString()
  }).catch(error=>{
    console.error("Error al sincronizar:",error);
    showToast("No se pudieron sincronizar los datos");
  });
}
function money(value,currency="DOP"){
  return new Intl.NumberFormat("es-DO",{style:"currency",currency,minimumFractionDigits:2}).format(Number(value)||0);
}
function showToast(message){
  const t=$("toast");
  t.textContent=message;
  t.classList.add("show");
  clearTimeout(showToast.timer);
  showToast.timer=setTimeout(()=>t.classList.remove("show"),2400);
}
function openModal(id){$(id).showModal();}
function closeModal(dialog){dialog.closest("dialog").close();}
function accountById(id){return data.accounts.find(a=>a.id===id);}
function signedEffect(tx, accountId){
  if(tx.type==="income" && tx.accountId===accountId) return Number(tx.amount);
  if(tx.type==="expense" && tx.accountId===accountId) return -Number(tx.amount);
  if(tx.type==="transfer"){
    if(tx.fromAccountId===accountId) return -Number(tx.amount);
    if(tx.toAccountId===accountId) return Number(tx.amount);
  }
  return 0;
}
function accountBalance(account){
  return Number(account.opening||0)+data.transactions.reduce((sum,tx)=>sum+signedEffect(tx,account.id),0);
}
function totals(currency){
  const txs=data.transactions.filter(t=>t.currency===currency);
  return {
    income:txs.filter(t=>t.type==="income").reduce((s,t)=>s+Number(t.amount),0),
    expense:txs.filter(t=>t.type==="expense").reduce((s,t)=>s+Number(t.amount),0)
  };
}
function monthTotals(currency){
  const current=monthKey(today());
  const txs=data.transactions.filter(t=>t.currency===currency && monthKey(t.date)===current);
  return {
    income:txs.filter(t=>t.type==="income").reduce((s,t)=>s+Number(t.amount),0),
    expense:txs.filter(t=>t.type==="expense").reduce((s,t)=>s+Number(t.amount),0)
  };
}
function fmtDate(d){return new Date(d+"T12:00:00").toLocaleDateString("es-DO",{day:"2-digit",month:"short",year:"numeric"});}
function populateSelect(select,items,selected){
  select.innerHTML=items.map(x=>`<option value="${escapeHtml(x.value)}">${escapeHtml(x.label)}</option>`).join("");
  if(selected) select.value=selected;
}
function escapeHtml(value){
  return String(value??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
}
function setCategoryOptions(type){
  populateSelect($("category"),CATEGORIES[type].map(c=>({value:c,label:c})));
}
function refreshAccountOptions(){
  const opts=data.accounts.map(a=>({value:a.id,label:`${a.name} (${a.currency==="DOP"?"RD$":"US$"})`}));
  ["transactionAccount","fromAccount","toAccount"].forEach(id=>populateSelect($(id),opts));
  if(data.accounts.length<1) showToast("Añade una cuenta antes de registrar movimientos.");
}
function renderOverview(){
  const currency=$("currencySelect").value;
  const all=totals(currency), month=monthTotals(currency);
  const balance=data.accounts.filter(a=>a.currency===currency).reduce((s,a)=>s+accountBalance(a),0);
  $("totalBalance").textContent=money(balance,currency);
  $("totalIncome").textContent=money(all.income,currency);
  $("totalExpense").textContent=money(all.expense,currency);
  $("monthIncome").textContent=money(month.income,currency);
  $("monthExpense").textContent=money(month.expense,currency);
  $("monthLabel").textContent=new Date().toLocaleDateString("es-DO",{month:"long",year:"numeric"});
  const byCat={};
  data.transactions.filter(t=>t.type==="expense"&&t.currency===currency&&monthKey(t.date)===monthKey(today()))
    .forEach(t=>byCat[t.category]=(byCat[t.category]||0)+Number(t.amount));
  const entries=Object.entries(byCat).sort((a,b)=>b[1]-a[1]);
  const max=entries[0]?.[1]||1;
  $("categoryChart").innerHTML=entries.length?entries.map(([cat,val])=>`<div class="bar-row"><span>${escapeHtml(cat)}</span><div class="bar-track"><div class="bar-fill" style="width:${val/max*100}%"></div></div><strong>${money(val,currency)}</strong></div>`).join(""):'<p class="empty">Todavía no hay gastos registrados.</p>';
  const recent=[...data.transactions].sort((a,b)=>b.date.localeCompare(a.date)||b.createdAt-a.createdAt).slice(0,5);
  $("recentList").innerHTML=recent.length?recent.map(transactionHTML).join(""):'<p class="empty">Todavía no hay movimientos.</p>';
}
function transactionHTML(tx){
  const isIncome=tx.type==="income", isTransfer=tx.type==="transfer";
  const sign=isIncome?"+":isTransfer?"⇄":"−";
  const cls=isIncome?"income":isTransfer?"":"expense";
  const account=isTransfer?`${accountById(tx.fromAccountId)?.name||"Cuenta"} → ${accountById(tx.toAccountId)?.name||"Cuenta"}`:(accountById(tx.accountId)?.name||"Cuenta eliminada");
  return `<div class="transaction-row">
    <div class="tx-left"><div class="tx-icon">${isIncome?"↙":isTransfer?"⇄":"↗"}</div><div style="min-width:0"><div class="tx-title">${escapeHtml(tx.description)}</div><div class="tx-meta">${escapeHtml(tx.category||"Transferencia")} · ${fmtDate(tx.date)} · ${escapeHtml(account)}</div></div></div>
    <div><span class="tx-amount ${cls}">${sign} ${money(tx.amount,tx.currency)}</span><button class="delete-btn" data-delete-tx="${tx.id}" title="Eliminar">×</button></div>
  </div>`;
}
function renderTransactions(){
  const q=$("searchTransactions").value.toLowerCase(), filter=$("typeFilter").value;
  const list=[...data.transactions].sort((a,b)=>b.date.localeCompare(a.date)||b.createdAt-a.createdAt)
    .filter(t=>(filter==="all"||t.type===filter)&&(`${t.description} ${t.category||""} ${t.note||""}`).toLowerCase().includes(q));
  $("transactionList").innerHTML=list.length?list.map(transactionHTML).join(""):'<p class="empty">No se encontraron movimientos.</p>';
}
function renderAccounts(){
  $("accountList").innerHTML=data.accounts.length?data.accounts.map(a=>`<article class="account-card">
    <div class="account-top"><div><div class="account-name">${escapeHtml(a.name)}</div><div class="account-meta">${escapeHtml(a.type)} · ${a.currency==="DOP"?"Pesos dominicanos":"Dólares"}</div></div><button class="delete-btn" data-delete-account="${a.id}" title="Eliminar cuenta">Eliminar</button></div>
    <div class="account-balance">${money(accountBalance(a),a.currency)}</div><div class="account-meta">Saldo calculado a partir del saldo inicial y tus movimientos</div>
  </article>`).join(""):'<p class="empty card">No hay cuentas registradas.</p>';
}
function renderBudgets(){
  const month=monthKey(today());
  $("budgetList").innerHTML=data.budgets.length?data.budgets.map(b=>{
    const spent=data.transactions.filter(t=>t.type==="expense"&&t.category===b.category&&t.currency===b.currency&&monthKey(t.date)===month).reduce((s,t)=>s+Number(t.amount),0);
    const pct=b.limit?spent/b.limit*100:0;
    return `<article class="budget-card"><div class="budget-top"><strong>${escapeHtml(b.category)}</strong><button class="delete-btn" data-delete-budget="${b.id}">Eliminar</button></div><div class="account-meta">Gastado ${money(spent,b.currency)} de ${money(b.limit,b.currency)}</div><div class="progress ${pct>100?"over":""}"><span style="width:${Math.min(pct,100)}%"></span></div><div class="account-meta">${pct.toFixed(0)}% utilizado${pct>100?" · Has superado tu límite":""}</div></article>`;
  }).join(""):'<p class="empty card">Todavía no has creado presupuestos.</p>';
}

function renderDebts(){
  const dop=data.debts.filter(d=>d.currency==="DOP").reduce((s,d)=>s+Number(d.remaining),0);
  $("debtTotalDOP").textContent=money(dop,"DOP");
  $("debtCount").textContent=String(data.debts.length);
  $("debtList").innerHTML=data.debts.length?data.debts.map(d=>`
    <article class="budget-card">
      <div class="budget-top">
        <strong>${escapeHtml(d.name)}</strong>
        <button class="delete-btn" data-delete-debt="${d.id}">Eliminar</button>
      </div>
      <div class="account-balance negative">${money(d.remaining,d.currency)} pendiente</div>
      <div class="account-meta">Original: ${money(d.original,d.currency)} · Pagado: ${money(Math.max(0,d.original-d.remaining),d.currency)}</div>
      <div class="account-meta">${d.payment>0?`Pago habitual: ${money(d.payment,d.currency)} · `:""}${d.due?`Próximo pago: ${fmtDate(d.due)}`:"Sin fecha de pago"}</div>
      <button class="secondary-btn full" data-pay-debt="${d.id}">Registrar pago</button>
    </article>`).join(""):'<p class="empty card">Todavía no has registrado deudas.</p>';
}

function renderRecurring(){
  $("recurringList").innerHTML=data.recurring.length?data.recurring.map(r=>`
    <article class="budget-card">
      <div class="budget-top">
        <strong>${escapeHtml(r.name)}</strong>
        <button class="delete-btn" data-delete-recurring="${r.id}">Eliminar</button>
      </div>
      <div class="account-balance">${money(r.amount,r.currency)}</div>
      <div class="account-meta">${escapeHtml(r.category)} · ${r.frequency==="weekly"?"Semanal":r.frequency==="biweekly"?"Cada 2 semanas":"Mensual"} · Próximo: ${fmtDate(r.next)}</div>
      <button class="primary-btn full" data-pay-recurring="${r.id}">Registrar pago</button>
    </article>`).join(""):'<p class="empty card">Todavía no has añadido pagos recurrentes.</p>';
}

function renderMonthlyChart(){
  const c=$("currencySelect").value, now=new Date(), months=[];
  for(let i=5;i>=0;i--){
    const d=new Date(now.getFullYear(),now.getMonth()-i,1);
    const key=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`;
    const tx=data.transactions.filter(t=>t.currency===c&&monthKey(t.date)===key);
    months.push({
      label:d.toLocaleDateString("es-DO",{month:"short"}),
      income:tx.filter(t=>t.type==="income").reduce((s,t)=>s+Number(t.amount),0),
      expense:tx.filter(t=>t.type==="expense").reduce((s,t)=>s+Number(t.amount),0)
    });
  }
  const max=Math.max(1,...months.flatMap(m=>[m.income,m.expense]));
  $("monthlyChart").innerHTML=months.map(m=>`
    <div class="month-col">
      <div class="month-bars">
        <div class="month-bar income-bar" title="Ingresos: ${money(m.income,c)}" style="height:${m.income/max*100}%"></div>
        <div class="month-bar expense-bar" title="Gastos: ${money(m.expense,c)}" style="height:${m.expense/max*100}%"></div>
      </div>
      <span>${m.label}</span>
    </div>`).join("");
}

function renderReports(){
  const c=$("currencySelect").value,t=totals(c);
  $("reportIncome").textContent=money(t.income,c);
  $("reportExpense").textContent=money(t.expense,c);
  $("reportNet").textContent=money(t.income-t.expense,c);
  renderMonthlyChart();
}

// Devuelve todos los vencimientos y pagos programados.
function getCalendarEvents(){
  const events=[];
  data.debts.forEach(d=>{
    if(d.due && Number(d.remaining)>0){
      events.push({
        date:d.due,
        name:d.name,
        detail:`Pago de deuda · ${money(d.remaining,d.currency)} pendiente`,
        type:"debt"
      });
    }
  });
  data.recurring.forEach(r=>{
    if(r.next){
      events.push({
        date:r.next,
        name:r.name,
        detail:`Pago recurrente · ${money(r.amount,r.currency)}`,
        type:"recurring"
      });
    }
  });
  return events.sort((a,b)=>a.date.localeCompare(b.date));
}


function renderCalendar(){
  const year=calendarDate.getFullYear();
  const month=calendarDate.getMonth();
  const firstDay=new Date(year,month,1);
  const daysInMonth=new Date(year,month+1,0).getDate();
  const offset=(firstDay.getDay()+6)%7;
  const todayDate=localToday();
  const events=getCalendarEvents();

  $("calendarMonth").textContent=firstDay.toLocaleDateString("es-DO",{
    month:"long",year:"numeric"
  });

  const names=["Lun","Mar","Mié","Jue","Vie","Sáb","Dom"];
  let html=names.map(n=>`<div class="calendar-weekday">${n}</div>`).join("");

  for(let i=0;i<offset;i++){
    html+='<div class="calendar-day empty-day"></div>';
  }

  for(let day=1;day<=daysInMonth;day++){
    const date=`${year}-${String(month+1).padStart(2,"0")}-${String(day).padStart(2,"0")}`;
    const dayEvents=events.filter(ev=>ev.date===date);
    const classes=["calendar-day"];
    if(date===todayDate)classes.push("today");
    if(dayEvents.length)classes.push("has-event");
    if(date===calendarSelectedDate)classes.push("selected");

    html+=`
      <button type="button" class="${classes.join(" ")}" data-calendar-date="${date}">
        <span class="calendar-number">${day}</span>
        ${dayEvents.length?`<span class="calendar-dot">${dayEvents.length}</span>`:""}
      </button>`;
  }

  $("calendarGrid").innerHTML=html;

  const selectedEvents=events.filter(ev=>ev.date===calendarSelectedDate);

  $("calendarEvents").innerHTML=`
    <h3>${fmtDate(calendarSelectedDate)}</h3>
    ${selectedEvents.length?selectedEvents.map(ev=>{
      const status=ev.date<todayDate?"Vencido":ev.date===todayDate?"Vence hoy":"Pendiente";
      const statusClass=ev.date<todayDate?"overdue":ev.date===todayDate?"due-today":"pending";
      return `
        <div class="calendar-event">
          <div>
            <strong>${escapeHtml(ev.name)}</strong>
            <div class="account-meta">${escapeHtml(ev.detail)}</div>
          </div>
          <span class="event-status ${statusClass}">${status}</span>
        </div>`;
    }).join(""):'<p class="empty">No hay pagos programados para este día.</p>'}
  `;

  $("calendarGrid").querySelectorAll("[data-calendar-date]").forEach(button=>{
    button.addEventListener("click",()=>{
      calendarSelectedDate=button.dataset.calendarDate;
      renderCalendar();
    });
  });
}


function renderAll(){
  $("currencySelect").value=data.settings.currency;
  renderOverview();
  renderTransactions();
  renderAccounts();
  renderBudgets();
  renderDebts();
  renderRecurring();
  renderCalendar();
  renderReports();
}

function showTab(name){
  document.querySelectorAll(".tab").forEach(b=>b.classList.toggle("active",b.dataset.tab===name));
  document.querySelectorAll(".page").forEach(p=>p.classList.toggle("active",p.id===`page-${name}`));
}

function csvCell(v){return `"${String(v??"").replace(/"/g,'""')}"`;}

function download(name,content,type){
  const blob=new Blob([content],{type});
  const url=URL.createObjectURL(blob);
  const a=document.createElement("a");
  a.href=url;
  a.download=name;
  a.click();
  URL.revokeObjectURL(url);
}

function exportCSV(){
  const rows=[["Fecha","Tipo","Descripción","Categoría","Monto","Moneda","Cuenta","Nota"]];
  data.transactions.forEach(t=>rows.push([
    t.date,t.type,t.description,t.category||"",t.amount,t.currency,
    t.type==="transfer"
      ?`${accountById(t.fromAccountId)?.name||""} -> ${accountById(t.toAccountId)?.name||""}`
      :accountById(t.accountId)?.name||"",
    t.note||""
  ]));
  download("luar-finanzas-movimientos.csv","\uFEFF"+rows.map(r=>r.map(csvCell).join(",")).join("\n"),"text/csv;charset=utf-8");
}

function exportBackup(){
  download("luar-finanzas-respaldo.json",JSON.stringify(data,null,2),"application/json");
}

function init(){
  $("transactionDate").value=localToday();
  $("transferDate").value=localToday();
  $("currencySelect").value=data.settings.currency;
  $("mainCurrency").value=data.settings.currency;

  setCategoryOptions("expense");
  refreshAccountOptions();
  renderAll();

  if("serviceWorker" in navigator && location.protocol.startsWith("http")){
    navigator.serviceWorker.register("./service-worker.js").catch(()=>{});
  }
}

document.addEventListener("click",e=>{
  const tab=e.target.closest("[data-tab]");
  if(tab)showTab(tab.dataset.tab);

  const opener=e.target.closest("[data-open]");
  if(opener){
    if(!data.accounts.length){
      showToast("Primero añade una cuenta.");
      return;
    }
    if(opener.dataset.open==="transactionModal"){
      $("formType").value=opener.dataset.type||"expense";
      $("transactionType").value=$("formType").value;
      $("transactionTitle").textContent=$("formType").value==="income"?"Añadir ingreso":"Añadir gasto";
      setCategoryOptions($("formType").value);
      $("formCurrency").value=data.settings.currency;
      refreshAccountOptions();
      $("transactionDate").value=localToday();
    }
    openModal(opener.dataset.open);
  }

  const close=e.target.closest("[data-close]");
  if(close)closeModal(close);

  const delTx=e.target.closest("[data-delete-tx]");
  if(delTx&&confirm("¿Eliminar este movimiento? El saldo de la cuenta se recalculará.")){
    data.transactions=data.transactions.filter(t=>t.id!==delTx.dataset.deleteTx);
    saveData();
    showToast("Movimiento eliminado.");
  }

  const delAcc=e.target.closest("[data-delete-account]");
  if(delAcc){
    const id=delAcc.dataset.deleteAccount;
    if(data.accounts.length===1){
      showToast("Debes conservar al menos una cuenta.");
      return;
    }
    if(data.transactions.some(t=>t.accountId===id||t.fromAccountId===id||t.toAccountId===id)){
      showToast("Esta cuenta tiene movimientos. No se puede eliminar.");
      return;
    }
    if(confirm("¿Eliminar esta cuenta?")){
      data.accounts=data.accounts.filter(a=>a.id!==id);
      saveData();
    }
  }

  const delB=e.target.closest("[data-delete-budget]");
  if(delB&&confirm("¿Eliminar este presupuesto?")){
    data.budgets=data.budgets.filter(b=>b.id!==delB.dataset.deleteBudget);
    saveData();
  }

  const payDebt=e.target.closest("[data-pay-debt]");
  if(payDebt){
    const d=data.debts.find(x=>x.id===payDebt.dataset.payDebt);
    if(!d)return;

    populateSelect($("payDebtSelect"),[{value:d.id,label:d.name}]);
    populateSelect($("debtPayAccount"),data.accounts.filter(a=>a.currency===d.currency).map(a=>({value:a.id,label:a.name})));
    $("debtPayAmount").value=d.payment>0?Math.min(d.payment,d.remaining):"";
    $("debtPayDate").value=localToday();

    if(!data.accounts.some(a=>a.currency===d.currency)){
      showToast("Añade una cuenta con la misma moneda para registrar el pago.");
      return;
    }
    openModal("debtPayModal");
  }

  const payRecurring=e.target.closest("[data-pay-recurring]");
  if(payRecurring){
    const r=data.recurring.find(x=>x.id===payRecurring.dataset.payRecurring);
    const a=r&&accountById(r.accountId);

    if(!r||!a||a.currency!==r.currency){
      showToast("La cuenta asociada ya no está disponible.");
      return;
    }

    if(!confirm(`¿Confirmas que pagaste ${money(r.amount,r.currency)} por ${r.name}?`))return;

    data.transactions.push({
      id:crypto.randomUUID(),
      type:"expense",
      description:r.name,
      amount:r.amount,
      currency:r.currency,
      category:r.category,
      accountId:r.accountId,
      date:r.next,
      note:"Pago recurrente registrado manualmente",
      createdAt:Date.now()
    });

    const d=new Date(r.next+"T12:00:00");
    if(r.frequency==="weekly")d.setDate(d.getDate()+7);
    else if(r.frequency==="biweekly")d.setDate(d.getDate()+14);
    else d.setMonth(d.getMonth()+1);

    r.next=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
    saveData();
    showToast("Pago recurrente registrado.");
  }

  const delDebt=e.target.closest("[data-delete-debt]");
  if(delDebt&&confirm("¿Eliminar esta deuda del control? Los movimientos ya registrados no se borrarán.")){
    data.debts=data.debts.filter(d=>d.id!==delDebt.dataset.deleteDebt);
    saveData();
  }

  const delRecurring=e.target.closest("[data-delete-recurring]");
  if(delRecurring&&confirm("¿Eliminar este pago recurrente? Los pagos ya registrados no se borrarán.")){
    data.recurring=data.recurring.filter(r=>r.id!==delRecurring.dataset.deleteRecurring);
    saveData();
  }
});

$("prevCalendarMonth").addEventListener("click",()=>{
  calendarDate.setMonth(calendarDate.getMonth()-1);
  renderCalendar();
});

$("nextCalendarMonth").addEventListener("click",()=>{
  calendarDate.setMonth(calendarDate.getMonth()+1);
  renderCalendar();
});

$("formType").addEventListener("change",e=>{
  setCategoryOptions(e.target.value);
  $("transactionTitle").textContent=e.target.value==="income"?"Añadir ingreso":"Añadir gasto";
});

$("transactionForm").addEventListener("submit",e=>{
  e.preventDefault();
  const type=$("formType").value;
  const account=accountById($("transactionAccount").value);
  const amount=Number($("amount").value);
  const currency=$("formCurrency").value;

  if(!account||!Number.isFinite(amount)||amount<=0){
    showToast("Revisa la cuenta y el monto.");
    return;
  }
  if(account.currency!==currency){
    showToast("La moneda del movimiento debe coincidir con la cuenta seleccionada.");
    return;
  }

  data.transactions.push({
    id:crypto.randomUUID(),
    type,
    description:$("description").value.trim(),
    amount,
    currency,
    category:$("category").value,
    accountId:account.id,
    date:$("transactionDate").value,
    note:$("note").value.trim(),
    createdAt:Date.now()
  });

  saveData();
  e.target.closest("dialog").close();
  e.target.reset();
  $("transactionDate").value=localToday();
  showToast("Movimiento guardado correctamente.");
});

$("transferForm").addEventListener("submit",e=>{
  e.preventDefault();
  const from=accountById($("fromAccount").value);
  const to=accountById($("toAccount").value);
  const amount=Number($("transferAmount").value);

  if(!from||!to||from.id===to.id||from.currency!==to.currency||amount<=0){
    showToast("Elige dos cuentas distintas con la misma moneda y un monto válido.");
    return;
  }

  data.transactions.push({
    id:crypto.randomUUID(),
    type:"transfer",
    description:$("transferDescription").value.trim(),
    amount,
    currency:from.currency,
    fromAccountId:from.id,
    toAccountId:to.id,
    date:$("transferDate").value,
    createdAt:Date.now()
  });

  saveData();
  e.target.closest("dialog").close();
  e.target.reset();
  $("transferDate").value=localToday();
  showToast("Transferencia registrada.");
});

$("accountForm").addEventListener("submit",e=>{
  e.preventDefault();
  data.accounts.push({
    id:crypto.randomUUID(),
    name:$("accountName").value.trim(),
    type:$("accountType").value,
    opening:Number($("openingBalance").value)||0,
    currency:$("accountCurrency").value
  });
  saveData();
  e.target.closest("dialog").close();
  e.target.reset();
  showToast("Cuenta añadida.");
});

$("budgetForm").addEventListener("submit",e=>{
  e.preventDefault();
  const category=$("budgetCategory").value;
  const currency=$("budgetCurrency").value;
  const limit=Number($("budgetLimit").value);

  if(limit<=0){
    showToast("Introduce un límite válido.");
    return;
  }

  data.budgets=data.budgets.filter(b=>!(b.category===category&&b.currency===currency));
  data.budgets.push({id:crypto.randomUUID(),category,currency,limit});
  saveData();
  e.target.closest("dialog").close();
  e.target.reset();
  showToast("Presupuesto guardado.");
});

$("addAccountBtn").addEventListener("click",()=>openModal("accountModal"));

$("addBudgetBtn").addEventListener("click",()=>{
  populateSelect($("budgetCategory"),CATEGORIES.expense.map(c=>({value:c,label:c})));
  $("budgetCurrency").value=data.settings.currency;
  openModal("budgetModal");
});


$("settingsBtn").addEventListener("click",()=>{
  $("mainCurrency").value = data.settings.currency;

  const selectedBanks = data.settings.bankSources || [];

  document.querySelectorAll('input[name="bankSources"]').forEach(input=>{
    input.checked = selectedBanks.includes(input.value);
  });

  openModal("settingsModal");
});



$("settingsForm").addEventListener("submit",e=>{
  e.preventDefault();

  data.settings.currency = $("mainCurrency").value;

  data.settings.bankSources = Array.from(
    document.querySelectorAll('input[name="bankSources"]:checked')
  ).map(input => input.value);

  saveData();

  e.target.closest("dialog").close();
  showToast("Configuración guardada.");
});


$("clearDataBtn").addEventListener("click",()=>{
  if(confirm("Esto eliminará permanentemente los movimientos, cuentas y presupuestos guardados en este navegador. ¿Continuar?")){
    data=defaultData();
    saveData();
    $("settingsModal").close();
    showToast("Datos eliminados.");
  }
});

$("currencySelect").addEventListener("change",e=>{
  data.settings.currency=e.target.value;
  saveData();
});

$("searchTransactions").addEventListener("input",renderTransactions);
$("typeFilter").addEventListener("change",renderTransactions);
$("exportBtn").addEventListener("click",exportCSV);
$("backupBtn").addEventListener("click",exportBackup);

$("restoreInput").addEventListener("change",async e=>{
  const file=e.target.files[0];
  if(!file)return;

  try{
    const parsed=JSON.parse(await file.text());
    if(!Array.isArray(parsed.accounts)||!Array.isArray(parsed.transactions)||!Array.isArray(parsed.budgets)){
      throw new Error("Formato inválido");
    }

    parsed.debts=Array.isArray(parsed.debts)?parsed.debts:[];
    parsed.recurring=Array.isArray(parsed.recurring)?parsed.recurring:[];

    if(confirm("Restaurar reemplazará los datos actuales de este dispositivo. ¿Continuar?")){
      data=parsed;
      saveData();
      showToast("Copia restaurada.");
    }
  }catch(err){
    showToast("No se pudo leer la copia de seguridad.");
  }
  e.target.value="";
});

$("addDebtBtn").addEventListener("click",()=>{
  $("debtCurrency").value=data.settings.currency;
  openModal("debtModal");
});

$("debtForm").addEventListener("submit",e=>{
  e.preventDefault();
  const original=Number($("debtOriginal").value);
  const remaining=Number($("debtRemaining").value);

  if(original<=0||remaining<0||remaining>original){
    showToast("El saldo pendiente debe estar entre cero y el monto original.");
    return;
  }

  data.debts.push({
    id:crypto.randomUUID(),
    name:$("debtName").value.trim(),
    original,
    remaining,
    payment:Number($("debtPayment").value)||0,
    currency:$("debtCurrency").value,
    due:$("debtDue").value
  });

  saveData();
  e.target.closest("dialog").close();
  e.target.reset();
  showToast("Deuda guardada.");
});

$("addRecurringBtn").addEventListener("click",()=>{
  populateSelect($("recurringCategory"),CATEGORIES.expense.map(c=>({value:c,label:c})));
  refreshAccountOptions();
  populateSelect($("recurringAccount"),data.accounts.map(a=>({value:a.id,label:`${a.name} (${a.currency==="DOP"?"RD$":"US$"})`})));
  $("recurringCurrency").value=data.settings.currency;
  $("recurringNext").value=localToday();
  openModal("recurringModal");
});

$("recurringForm").addEventListener("submit",e=>{
  e.preventDefault();
  const account=accountById($("recurringAccount").value);
  const currency=$("recurringCurrency").value;
  const amount=Number($("recurringAmount").value);

  if(!account||account.currency!==currency||amount<=0){
    showToast("La cuenta debe tener la misma moneda y el monto ser válido.");
    return;
  }

  data.recurring.push({
    id:crypto.randomUUID(),
    name:$("recurringName").value.trim(),
    amount,
    category:$("recurringCategory").value,
    currency,
    accountId:account.id,
    frequency:$("recurringFrequency").value,
    next:$("recurringNext").value
  });

  saveData();
  e.target.closest("dialog").close();
  e.target.reset();
  showToast("Pago recurrente guardado.");
});

$("debtPayForm").addEventListener("submit",e=>{
  e.preventDefault();
  const debt=data.debts.find(d=>d.id===$("payDebtSelect").value);
  const account=accountById($("debtPayAccount").value);
  const amount=Number($("debtPayAmount").value);
  const date=$("debtPayDate").value;

  if(!debt||!account||account.currency!==debt.currency||amount<=0||amount>debt.remaining){
    showToast("Revisa la deuda, la cuenta y el monto del pago.");
    return;
  }

  debt.remaining=Math.max(0,debt.remaining-amount);
  data.transactions.push({
    id:crypto.randomUUID(),
    type:"expense",
    description:`Pago de deuda: ${debt.name}`,
    amount,
    currency:debt.currency,
    category:"Deudas",
    accountId:account.id,
    date,
    note:"Pago registrado desde el control de deudas",
    createdAt:Date.now()
  });

  saveData();
  e.target.closest("dialog").close();
  e.target.reset();
  showToast("Pago de deuda registrado.");
});

init();
// INICIO DE SESIÓN CON GOOGLE

$("googleLoginBtn").addEventListener("click", async ()=>{
  $("loginMessage").textContent = "Conectando con Google...";

  try {
    await signInWithPopup(auth, googleProvider);
  } catch(error) {
    console.error(error);
    $("loginMessage").textContent = "No se pudo iniciar sesión. Inténtalo nuevamente.";
  }
});

onAuthStateChanged(auth, async (user)=>{
  currentUser = user;

  if(!user){
    $("appContent").style.display = "none";
    $("loginScreen").style.display = "flex";
    return;
  }
  // MOSTRAR PERFIL DE GOOGLE

$("profileName").textContent = user.displayName || "Mi cuenta";
$("profileEmail").textContent = user.email || "";

const profilePhoto = $("profilePhoto");

if(user.photoURL){
  profilePhoto.src = user.photoURL;
  profilePhoto.style.display = "block";
} else {
  profilePhoto.style.display = "none";
}
  $("loginMessage").textContent = "Cargando tus datos...";

  try {
    const userRef = doc(db,"users",user.uid);
    const userDoc = await getDoc(userRef);

    if(userDoc.exists() && userDoc.data().data){
      data = userDoc.data().data;
    } else {
      const hasOldData = localStorage.getItem(DB_KEY) !== null;

      if(hasOldData && confirm(
        "Encontramos datos guardados anteriormente en este dispositivo. ¿Quieres importarlos a esta cuenta de Google? Asegúrate de que sean tuyos."
      )){
        data = legacyData;
      } else {
        data = defaultData();
      }

      await setDoc(userRef,{
        data: data,
        updatedAt: new Date().toISOString()
      });
    }

    const userKey = DB_KEY + "_" + user.uid;
    localStorage.setItem(userKey,JSON.stringify(data));

    $("loginScreen").style.display = "none";
    $("appContent").style.display = "block";

    renderAll();
    await refreshGmailStatus();

  } catch(error) {
    console.error("Error cargando datos:",error);
    $("loginMessage").textContent = "Error al cargar tus datos. Revisa tu conexión.";
  }
});

// CERRAR SESIÓN

$("logoutBtn").addEventListener("click", ()=>{
  signOut(auth);
});

// GMAIL: conexión, estado y sincronización de movimientos
const GMAIL_API = "https://luar-finanzas-api.luarsitoinoa.workers.dev";
const connectGmailBtn = $("connectGmailBtn");

async function gmailRequest(path, method = "GET", body = null) {
  if (!currentUser) throw new Error("Debes iniciar sesión.");
  const idToken = await currentUser.getIdToken();
  const response = await fetch(`${GMAIL_API}${path}`, {
    method,
    headers: {
      "Authorization": `Bearer ${idToken}`,
      ...(body ? { "Content-Type": "application/json" } : {})
    },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(result.error || "No se pudo completar la operación con Gmail.");
    error.code = result.code;
    throw error;
  }
  return result;
}

async function refreshGmailStatus() {
  if (!connectGmailBtn || !currentUser) return;
  try {
    const status = await gmailRequest("/gmail/status");
    gmailConnected = Boolean(status.connected);
    connectGmailBtn.textContent = gmailConnected ? "Sincronizar Gmail" : "Conectar Gmail";
    if (gmailConnected && status.email) {
      connectGmailBtn.title = `Gmail conectado: ${status.email}`;
    } else {
      connectGmailBtn.removeAttribute("title");
    }
  } catch (error) {
    console.warn("No se pudo consultar el estado de Gmail:", error);
    connectGmailBtn.textContent = "Conectar Gmail";
  }
}

function accountForImportedBank(bank) {
  const aliases = {
    banreservas: ["banreservas", "banco de reservas", "reservas"],
    bhd: ["bhd", "banco bhd"],
    popular: ["banco popular", "popular"],
    qik: ["qik"],
    token: ["token"]
  };
  const terms = aliases[bank] || [bank];
  return data.accounts.find(account => {
    const label = `${account.name || ""} ${account.type || ""} ${account.bank || ""} ${account.institution || ""}`.toLowerCase();
    return terms.some(term => label.includes(term));
  }) || null;
}

async function persistImportedTransactions(movements) {
  const importedIds = [];
  let added = 0;
  for (const movement of movements || []) {
    if (!movement.gmailMessageId || data.transactions.some(tx => tx.gmailMessageId === movement.gmailMessageId)) {
      if (movement.gmailMessageId) importedIds.push(movement.gmailMessageId);
      continue;
    }
    const account = accountForImportedBank(movement.bank);
    if (!account) continue;
    const amount = Number(movement.amount);
    if (!Number.isFinite(amount) || amount <= 0 || !["income", "expense"].includes(movement.type)) continue;
    const currency = movement.currency === "USD" ? "USD" : "DOP";
    if (account.currency !== currency) continue;
    data.transactions.push({
      id: crypto.randomUUID(),
      type: movement.type,
      description: String(movement.description || (movement.type === "income" ? "Ingreso bancario" : "Gasto bancario")).slice(0, 120),
      amount,
      currency,
      category: movement.category || (movement.type === "income" ? "Otros" : "Otros"),
      accountId: account.id,
      date: /^\d{4}-\d{2}-\d{2}$/.test(movement.date || "") ? movement.date : localToday(),
      note: `Importado desde Gmail · ${movement.bankName || movement.bank}`,
      gmailMessageId: movement.gmailMessageId,
      source: "gmail",
      createdAt: Date.now()
    });
    importedIds.push(movement.gmailMessageId);
    added++;
  }

  // Guardamos primero en Firestore; solo después confirmamos al Worker los correos importados.
  if (added > 0) {
    const userKey = DB_KEY + "_" + currentUser.uid;
    localStorage.setItem(userKey, JSON.stringify(data));
    await setDoc(doc(db, "users", currentUser.uid), {
      data,
      updatedAt: new Date().toISOString()
    });
    renderAll();
  }
  if (importedIds.length) await gmailRequest("/gmail/ack", "POST", { ids: importedIds });
  return { added, skipped: (movements || []).length - added };
}

async function synchronizeGmail() {
  if (!currentUser) {
    showToast("Primero debes iniciar sesión.");
    return;
  }
  if (connectGmailBtn) {
    connectGmailBtn.disabled = true;
    connectGmailBtn.textContent = "Sincronizando...";
  }
  try {
    const result = await gmailRequest("/gmail/sync", "POST", {});
    const outcome = await persistImportedTransactions(result.movements || []);
    if (outcome.added > 0) {
      showToast(`Se importaron ${outcome.added} movimiento(s).`);
    } else if ((result.movements || []).length > 0) {
      showToast("Se encontraron correos, pero no coincidieron con una cuenta y moneda configuradas.");
    } else {
      showToast("Sin movimientos bancarios nuevos reconocidos.");
    }
  } catch (error) {
    console.error("Error sincronizando Gmail:", error);
    if (error.code === "NOT_CONNECTED") {
      gmailConnected = false;
      showToast("Primero conecta tu Gmail.");
    } else if (error.code === "RECONNECT_REQUIRED") {
      gmailConnected = false;
      showToast("La autorización de Gmail venció. Vuelve a conectar Gmail.");
    } else {
      showToast("No se pudo sincronizar Gmail. Inténtalo otra vez.");
    }
  } finally {
    if (connectGmailBtn) {
      connectGmailBtn.disabled = false;
      connectGmailBtn.textContent = gmailConnected ? "Sincronizar Gmail" : "Conectar Gmail";
    }
  }
}

async function connectGmail() {
  if (!currentUser) {
    showToast("Primero debes iniciar sesión.");
    return;
  }
  const selectedBanks = Array.isArray(data.settings.bankSources) ? data.settings.bankSources : [];
  if (!selectedBanks.length) {
    showToast("Abre Configuración y selecciona al menos un banco.");
    return;
  }
  if (connectGmailBtn) {
    connectGmailBtn.disabled = true;
    connectGmailBtn.textContent = "Conectando...";
  }
  try {
    const result = await gmailRequest("/auth/google/start", "POST", { selectedBanks });
    if (!result.authorizationUrl) throw new Error("No se recibió el enlace de autorización.");
    window.location.href = result.authorizationUrl;
  } catch (error) {
    console.error("Error conectando Gmail:", error);
    showToast("No se pudo iniciar la conexión con Gmail.");
    if (connectGmailBtn) {
      connectGmailBtn.disabled = false;
      connectGmailBtn.textContent = "Conectar Gmail";
    }
  }
}

if (connectGmailBtn) {
  connectGmailBtn.addEventListener("click", () => {
    if (gmailConnected) synchronizeGmail();
    else connectGmail();
  });
}

// Mensaje breve al regresar del consentimiento de Google.
const gmailParams = new URLSearchParams(window.location.search);
if (gmailParams.get("gmail") === "connected") {
  showToast("Gmail quedó conectado. Ya puedes sincronizar.");
  gmailParams.delete("gmail");
  gmailParams.delete("reason");
  const cleanUrl = `${window.location.pathname}${gmailParams.toString() ? `?${gmailParams}` : ""}${window.location.hash}`;
  window.history.replaceState({}, "", cleanUrl);
} else if (gmailParams.get("gmail") === "error") {
  showToast("Google no terminó la conexión de Gmail. Revisa el permiso e inténtalo de nuevo.");
  gmailParams.delete("gmail");
  gmailParams.delete("reason");
  const cleanUrl = `${window.location.pathname}${gmailParams.toString() ? `?${gmailParams}` : ""}${window.location.hash}`;
  window.history.replaceState({}, "", cleanUrl);
}
