import{$ as e,B as t,Ct as n,Dt as r,Et as i,I as a,It as o,L as s,Lt as c,O as l,Q as u,R as d,Ut as f,V as p,Vt as m,X as h,Z as g,at as _,c as v,d as y,dt as b,f as ee,ft as x,l as S,lt as C,n as te,nt as ne,p as re,t as ie,u as w,vt as T,wt as ae}from"./ReleaseItemsModal-BT3eAbAe.js";import{K as E,d as oe,f as se,p as ce,u as D}from"./supabaseQueries-gVOPmZZ5.js";import{t as O}from"./phone-C6iWOkZd.js";import{t as le}from"./search-x-BqlMM62A.js";import{D as k,E as ue,O as A}from"./index-q9UfHJZR.js";var j=ae(`clock-3`,[[`circle`,{cx:`12`,cy:`12`,r:`10`,key:`1mglay`}],[`path`,{d:`M12 6v6h4`,key:`135r8i`}]]),M=f(m(),1);function de(e){let{clients:t}=l(),[n,r]=(0,M.useState)(null),[i,a]=(0,M.useState)(`loading`),[o,s]=(0,M.useState)(null),c=(0,M.useRef)(null),u=(0,M.useRef)(0),d=(0,M.useMemo)(()=>{let e={};for(let n of t)e[n.id]=n.name;return e},[t]),f=(0,M.useRef)(d);f.current=d;let p=(0,M.useCallback)(async()=>{if(!e)return;c.current?.abort();let t=new AbortController;c.current=t;let n=++u.current;a(`loading`),s(null);try{let i=await D(e,f.current);if(t.signal.aborted||n!==u.current)return;if(!i){a(`not-found`);return}r(i),a(`loaded`)}catch(e){if(t.signal.aborted||n!==u.current)return;s(e instanceof Error?e.message:`Failed to load order`),a(`error`)}},[e]);return(0,M.useEffect)(()=>(p(),()=>{c.current?.abort()}),[p]),{order:n,status:i,error:o,refetch:p}}function fe(e){let t=ge(e),n=window.open(``,`_blank`);if(!n){alert(`Please allow pop-ups for this site, then try again.`);return}n.document.open(),n.document.write(t),n.document.close(),setTimeout(()=>{try{n.print()}catch{}},450)}function N(e){return e==null?`—`:`$`+e.toLocaleString(`en-US`,{minimumFractionDigits:2,maximumFractionDigits:2})}function P(e){if(!e)return`—`;try{return new Date(e+`T00:00:00`).toLocaleDateString(`en-US`,{weekday:`short`,month:`short`,day:`numeric`,year:`numeric`})}catch{return e}}function F(e){if(!e)return`—`;try{return new Date(e).toLocaleString(`en-US`)}catch{return e}}function pe(e,t,n){if(!e&&!t)return`—`;let r=e=>{let[t,n]=e.split(`:`),r=parseInt(t);if(Number.isNaN(r))return e;let i=r>=12?`PM`:`AM`;return r===0?r=12:r>12&&(r-=12),`${r}:${n} ${i}`};return[e&&r(e),t&&r(t)].filter(Boolean).join(` – `)+(n===`America/Los_Angeles`?` PT`:n?` (${n})`:``)}function I(e){return e==null?``:String(e).replace(/&/g,`&amp;`).replace(/</g,`&lt;`).replace(/>/g,`&gt;`).replace(/"/g,`&quot;`).replace(/'/g,`&#39;`)}function L(e,t){return!t||t===`—`?``:`<tr><th>${I(e)}</th><td>${I(t)}</td></tr>`}function R(e){let t=pe(e.windowStartLocal,e.windowEndLocal,e.timezone),n=[L(`Service Date`,P(e.localServiceDate)),L(`Time Window`,t),L(`Order Type`,e.orderType?e.orderType.replace(/_/g,` `):null),L(`Scheduled`,F(e.scheduledAt)),L(`Started`,F(e.startedAt)),L(`Finished`,F(e.finishedAt))].filter(Boolean).join(``);return n?`<section><h2>Schedule</h2><table class="kv">${n}</table></section>`:``}function z(e){let t=[e.contactAddress,e.contactCity,e.contactState,e.contactZip].filter(Boolean).join(`, `),n=[L(`Name`,e.contactName),L(`Address`,t),L(`Phone`,e.contactPhone),L(`Email`,e.contactEmail)].filter(Boolean).join(``);return n?`<section><h2>${e.isPickup?`Pickup Contact`:`Delivery Contact`}</h2><table class="kv">${n}</table></section>`:``}function B(e){let t=[L(`PO Number`,e.poNumber),L(`Sidemark`,e.sidemark),L(`Client Reference`,e.clientReference),L(`Source`,e.source),e.dtDispatchId==null?``:L(`Dispatch ID`,String(e.dtDispatchId))].filter(Boolean).join(``),n=e.details?`<div class="notes-block"><div class="notes-label">Details / Notes</div><div class="notes-body">${I(e.details)}</div></div>`:``;return!t&&!n?``:`<section><h2>Order Details</h2>${t?`<table class="kv">${t}</table>`:``}${n}</section>`}function me(e){let t=[L(`Driver`,e.driverName),e.truckName?L(`Truck`,e.truckName):``,e.serviceUnit?L(`Service Unit`,e.serviceUnit):``,e.stopNumber==null?``:L(`Stop #`,String(e.stopNumber)),e.actualServiceTimeMinutes==null?``:L(`Service Time`,`${e.actualServiceTimeMinutes} min`),e.codAmount==null?``:L(`COD Amount`,N(e.codAmount)),e.signatureCapturedAt?L(`Signature Captured`,F(e.signatureCapturedAt)):``].filter(Boolean).join(``);return t?`<section><h2>Driver &amp; Route</h2><table class="kv">${t}</table></section>`:``}function V(e){return!e.items||e.items.length===0?`<section><h2>Items</h2><div class="empty">No items on this order.</div></section>`:`<section>
    <h2>Items</h2>
    <table class="items">
      <thead>
        <tr><th class="num">#</th><th>Description</th><th class="num">Qty</th><th class="num">Delivered</th><th class="num">Amount</th></tr>
      </thead>
      <tbody>${e.items.map((e,t)=>{let n=e.quantity==null?`—`:String(e.quantity),r=e.deliveredQuantity==null?``:String(e.deliveredQuantity),i=e.unitPrice!=null&&e.unitPrice>0?N(e.unitPrice):``,a=[];e.dtItemCode&&a.push(`SKU ${I(e.dtItemCode)}`),e.vendor&&a.push(`Vendor: ${I(e.vendor)}`),e.sidemark&&a.push(`Sidemark: ${I(e.sidemark)}`),e.location&&a.push(`Location: ${I(e.location)}`),e.room&&a.push(`Room: ${I(e.room)}`);let o=a.length>0?`<div class="item-meta">${a.join(` · `)}</div>`:``,s=e.notes?`<div class="item-note">${I(e.notes)}</div>`:``,c=e.itemNote?`<div class="item-driver-note"><strong>Driver note:</strong> ${I(e.itemNote)}</div>`:``;return`
      <tr>
        <td class="num">${t+1}</td>
        <td>
          <div class="item-desc">${I(e.description||`—`)}</div>
          ${o}
          ${s}
          ${c}
        </td>
        <td class="num">${n}</td>
        <td class="num">${I(r)}</td>
        <td class="num">${I(i)}</td>
      </tr>`}).join(``)}</tbody>
    </table>
  </section>`}function he(e){if(!(e.baseDeliveryFee!=null||e.orderTotal!=null||(e.accessorials?.length??0)>0||e.extraItemsCount>0||e.fabricProtectionTotal>0))return``;let t=[];if(e.baseDeliveryFee!=null&&t.push(`<tr><td>${e.isPickup?`Base Pickup Fee`:`Base Delivery Fee`}</td><td class="num">${N(e.baseDeliveryFee)}</td></tr>`),e.extraItemsCount>0&&t.push(`<tr><td>Extra Items (${e.extraItemsCount} × $25)</td><td class="num">${N(e.extraItemsFee)}</td></tr>`),e.accessorials?.length)for(let n of e.accessorials){let e=n.code+(n.quantity>1?` × ${n.quantity}`:``);t.push(`<tr><td>${I(e)}</td><td class="num">${N(n.subtotal)}</td></tr>`)}e.fabricProtectionTotal>0&&t.push(`<tr><td>Fabric Protection</td><td class="num">${N(e.fabricProtectionTotal)}</td></tr>`);let n=e.orderTotal==null?``:`<tr class="total-row"><td>Order Total${e.pricingOverride?` <span class="manual-badge">MANUAL</span>`:``}</td><td class="num">${N(e.orderTotal)}</td></tr>`,r=e.pricingNotes?`<div class="pricing-notes">${I(e.pricingNotes)}</div>`:``;return`<section>
    <h2>Pricing</h2>
    <table class="totals">${t.join(``)}${n}</table>
    ${r}
  </section>`}function ge(e){let t=e.dtIdentifier||e.id.slice(0,8).toUpperCase(),n=e.statusName||e.statusCode||`—`,r=new Date().toLocaleString(`en-US`),i=e.isPickup?`Pickup Order`:`Delivery Order`,a=[R(e),z(e),B(e),V(e),he(e),me(e)].filter(Boolean).join(``);return`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>${I(i)} — ${I(t)}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: #F5F2EE;
      color: #1C1C1C;
      font-size: 12.5px;
      line-height: 1.55;
    }

    .print-header {
      background: #1C1C1C;
      color: #fff;
      padding: 18px 32px;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .header-brand { display: flex; align-items: center; gap: 12px; }
    .header-logo {
      width: 38px; height: 38px; border-radius: 8px;
      background: #E8692A;
      display: flex; align-items: center; justify-content: center;
      font-size: 18px; font-weight: 900; color: #fff; letter-spacing: -1px;
    }
    .header-name { font-size: 15px; font-weight: 700; letter-spacing: 2.5px; }
    .header-sub  { font-size: 10px; letter-spacing: 1.5px; color: rgba(255,255,255,0.5); margin-top: 2px; }
    .header-meta { text-align: right; font-size: 11px; color: rgba(255,255,255,0.7); line-height: 1.5; }
    .header-meta strong { color: #fff; font-size: 13px; }
    .header-id { color: #fff; font-size: 18px; font-weight: 700; letter-spacing: 0.5px; }

    .doc-body { max-width: 820px; margin: 0 auto; padding: 28px 24px 48px; }

    .order-summary {
      background: #fff;
      border: 1px solid rgba(0,0,0,0.07);
      border-radius: 12px;
      padding: 16px 20px;
      margin-bottom: 16px;
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 16px;
    }
    .summary-block { flex: 1; min-width: 0; }
    .summary-label { font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: 1.5px; color: #94A3B8; margin-bottom: 4px; }
    .summary-value { font-size: 14px; font-weight: 600; color: #1C1C1C; word-break: break-word; }
    .summary-status {
      display: inline-block;
      padding: 3px 10px;
      border-radius: 100px;
      background: #EFF6FF;
      color: #1D4ED8;
      font-size: 11px;
      font-weight: 600;
    }

    section {
      background: #fff;
      border-radius: 12px;
      padding: 18px 20px;
      margin-bottom: 14px;
      border: 1px solid rgba(0,0,0,0.07);
    }
    h2 {
      font-size: 11px; font-weight: 700; color: #94A3B8;
      text-transform: uppercase; letter-spacing: 2px;
      margin-bottom: 12px; padding-bottom: 8px;
      border-bottom: 1px solid #F0ECE6;
    }

    table.kv { width: 100%; border-collapse: collapse; }
    table.kv th, table.kv td { padding: 5px 0; font-size: 12px; vertical-align: top; }
    table.kv th {
      width: 140px;
      text-align: left;
      font-weight: 500;
      color: #64748B;
      font-size: 11px;
    }
    table.kv td { color: #1C1C1C; font-weight: 500; }

    .notes-block { margin-top: 10px; padding: 10px 12px; background: #F8FAFC; border-radius: 8px; border-left: 3px solid #E8692A; }
    .notes-label { font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: 1.5px; color: #94A3B8; margin-bottom: 4px; }
    .notes-body { font-size: 12px; color: #334155; white-space: pre-wrap; }

    table.items { width: 100%; border-collapse: collapse; }
    table.items thead th {
      font-size: 9.5px;
      font-weight: 700;
      color: #64748B;
      text-transform: uppercase;
      letter-spacing: 1.2px;
      text-align: left;
      padding: 6px 8px;
      border-bottom: 1.5px solid #E2E8F0;
    }
    table.items td { padding: 8px; font-size: 12px; vertical-align: top; border-bottom: 1px solid #F1F5F9; }
    table.items tbody tr:last-child td { border-bottom: none; }
    table.items .num { text-align: right; white-space: nowrap; }
    table.items thead th.num { text-align: right; }
    .item-desc { font-weight: 600; color: #1C1C1C; margin-bottom: 2px; }
    .item-meta { font-size: 11px; color: #64748B; line-height: 1.45; }
    .item-note { font-size: 11px; color: #94A3B8; font-style: italic; margin-top: 3px; }
    .item-driver-note {
      font-size: 11px; color: #92400E;
      margin-top: 4px;
      padding: 5px 8px;
      background: #FFFBEB;
      border-left: 2px solid #F59E0B;
      border-radius: 4px;
    }

    table.totals { width: 100%; border-collapse: collapse; }
    table.totals td { padding: 5px 0; font-size: 12.5px; }
    table.totals td.num { text-align: right; font-weight: 600; }
    table.totals td:first-child { color: #475569; }
    table.totals .total-row td {
      padding-top: 10px;
      margin-top: 10px;
      border-top: 1.5px solid #E2E8F0;
      font-size: 14px;
      font-weight: 700;
      color: #1C1C1C;
    }
    .manual-badge {
      display: inline-block;
      margin-left: 6px;
      padding: 1px 6px;
      background: #FEF3C7;
      color: #B45309;
      font-size: 9px;
      font-weight: 700;
      border-radius: 6px;
      vertical-align: middle;
    }
    .pricing-notes {
      font-size: 11px;
      color: #94A3B8;
      font-style: italic;
      margin-top: 8px;
    }
    .empty { font-size: 12px; color: #94A3B8; padding: 6px 0; }

    .print-footer {
      text-align: center; font-size: 10.5px; color: #94A3B8;
      margin-top: 24px; padding-top: 14px;
      border-top: 1px solid #E2E8F0; line-height: 1.6;
    }

    @media print {
      body { background: #fff; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      .print-header { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      section { break-inside: avoid; }
      table.items tr { break-inside: avoid; }
      @page { margin: 0.4in; size: letter; }
    }
  </style>
</head>
<body>
  <div class="print-header">
    <div class="header-brand">
      <div class="header-logo">S</div>
      <div>
        <div class="header-name">STRIDE</div>
        <div class="header-sub">LOGISTICS</div>
      </div>
    </div>
    <div class="header-meta">
      <div>${I(i)}</div>
      <div class="header-id">${I(t)}</div>
      <div>Generated ${I(r)}</div>
    </div>
  </div>
  <div class="doc-body">
    <div class="order-summary">
      <div class="summary-block">
        <div class="summary-label">Client</div>
        <div class="summary-value">${I(e.clientName||`—`)}</div>
      </div>
      <div class="summary-block">
        <div class="summary-label">Status</div>
        <div class="summary-value"><span class="summary-status">${I(n)}</span></div>
      </div>
      <div class="summary-block" style="text-align:right;">
        <div class="summary-label">Service Date</div>
        <div class="summary-value">${I(P(e.localServiceDate))}</div>
      </div>
    </div>
    ${a}
    <div class="print-footer">
      Stride Logistics · Express Installation Services Inc, DBA Stride Logistics · 19803 87th Ave S, Kent, WA 98031<br>
      info@stridenw.com · mystridehub.com<br>
      ${I(i)} ${I(t)} — generated ${I(r)}
    </div>
  </div>
</body>
</html>`}var H=r(),_e={open:{bg:`#EFF6FF`,color:`#1D4ED8`,label:`Open`},in_progress:{bg:`#EDE9FE`,color:`#7C3AED`,label:`In Progress`},completed:{bg:`#F0FDF4`,color:`#15803D`,label:`Completed`},exception:{bg:`#FEF2F2`,color:`#DC2626`,label:`Exception`},cancelled:{bg:`#F3F4F6`,color:`#6B7280`,label:`Cancelled`}},U={pending_review:{bg:`#FEF3C7`,color:`#B45309`,label:`Pending Review`,icon:(0,H.jsx)(j,{size:11})},approved:{bg:`#DCFCE7`,color:`#166534`,label:`Approved`,icon:(0,H.jsx)(b,{size:11})},rejected:{bg:`#FEE2E2`,color:`#991B1B`,label:`Rejected`,icon:(0,H.jsx)(x,{size:11})},revision_requested:{bg:`#FEF3C7`,color:`#92400E`,label:`Revision Needed`,icon:(0,H.jsx)(x,{size:11})}},ve=[{value:`pending_review`,label:`Pending Review`},{value:`approved`,label:`Approved`},{value:`rejected`,label:`Rejected`},{value:`revision_requested`,label:`Revision Requested`},{value:`not_required`,label:`Not Required`}];function W(e){return{contactName:e.contactName??``,contactAddress:e.contactAddress??``,contactCity:e.contactCity??``,contactState:e.contactState??``,contactZip:e.contactZip??``,contactPhone:e.contactPhone??``,contactEmail:e.contactEmail??``,localServiceDate:e.localServiceDate??``,windowStartLocal:(e.windowStartLocal??``).slice(0,5),windowEndLocal:(e.windowEndLocal??``).slice(0,5),poNumber:e.poNumber??``,sidemark:e.sidemark??``,clientReference:e.clientReference??``,details:e.details??``,orderTotal:e.orderTotal==null?``:String(e.orderTotal),baseDeliveryFee:e.baseDeliveryFee==null?``:String(e.baseDeliveryFee),reviewStatus:e.reviewStatus??`pending_review`,reviewNotes:e.reviewNotes??``}}function G(e){return`$${e.toFixed(2)}`}function K(e){if(!e)return`—`;try{return new Date(e+`T00:00:00`).toLocaleDateString(`en-US`,{weekday:`short`,month:`short`,day:`numeric`,year:`numeric`})}catch{return e}}function q(e,t,n){if(!e&&!t)return`—`;let r=e=>{let[t,n]=e.split(`:`),r=parseInt(t),i=r>=12?`PM`:`AM`;return r===0?r=12:r>12&&(r-=12),`${r}:${n} ${i}`};return[e&&r(e),t&&r(t)].filter(Boolean).join(` – `)+(n===`America/Los_Angeles`?` PT`:n?` (${n})`:``)}var J={width:`100%`,padding:`7px 10px`,fontSize:13,border:`1px solid ${s.colors.border}`,borderRadius:8,outline:`none`,fontFamily:`inherit`,boxSizing:`border-box`,background:`#fff`};function Y({label:e,value:t,icon:n}){return t?(0,H.jsxs)(`div`,{style:{marginBottom:14},children:[(0,H.jsx)(y,{children:n?(0,H.jsxs)(`span`,{style:{display:`inline-flex`,alignItems:`center`,gap:4},children:[n,e]}):e}),(0,H.jsx)(`div`,{style:{fontSize:13,color:v.textPrimary,lineHeight:1.5},children:t})]}):null}function X({label:e,value:t,onChange:n,type:r=`text`,rows:i,options:a,icon:o}){return(0,H.jsxs)(`div`,{style:{marginBottom:12},children:[(0,H.jsx)(y,{children:o?(0,H.jsxs)(`span`,{style:{display:`inline-flex`,alignItems:`center`,gap:4},children:[o,e]}):e}),r===`textarea`?(0,H.jsx)(`textarea`,{value:t,onChange:e=>n(e.target.value),rows:i??3,style:{...J,resize:`vertical`}}):r===`select`?(0,H.jsx)(`select`,{value:t,onChange:e=>n(e.target.value),style:J,children:a.map(e=>(0,H.jsx)(`option`,{value:e.value,children:e.label},e.value))}):(0,H.jsx)(`input`,{type:r,value:t,onChange:e=>n(e.target.value),style:J})]})}function Z({children:e}){return(0,H.jsx)(`div`,{style:{fontSize:10,fontWeight:700,color:v.textMuted,textTransform:`uppercase`,letterSpacing:`2px`,marginBottom:14,paddingBottom:8,borderBottom:`1px solid ${s.colors.border}`},children:e})}var ye={display:`inline-flex`,alignItems:`center`,gap:6,padding:`${s.spacing.sm} ${s.spacing.lg}`,borderRadius:s.radii.lg,border:`1px solid ${s.colors.border}`,background:s.colors.bgCard,color:s.colors.text,fontSize:s.typography.sizes.base,fontWeight:s.typography.weights.medium,cursor:`pointer`,fontFamily:`inherit`};function be({icon:e,color:t,title:n,body:r,actions:i}){return(0,H.jsxs)(`div`,{style:{display:`flex`,flexDirection:`column`,alignItems:`center`,justifyContent:`center`,height:`100%`,gap:16,padding:32,textAlign:`center`},children:[(0,H.jsx)(e,{size:48,color:t}),(0,H.jsx)(`div`,{style:{fontSize:18,fontWeight:600,color:s.colors.text},children:n}),(0,H.jsx)(`div`,{style:{fontSize:14,color:s.colors.textMuted,maxWidth:400},children:r}),i]})}function xe({order:e,editing:t,edit:n,setField:r,saving:i,saveError:o,onStartEdit:c,onCancelEdit:l,onSave:f}){let m=[e.contactAddress,e.contactCity,e.contactState,e.contactZip].filter(Boolean).join(`, `),y=e.baseDeliveryFee!=null||e.orderTotal!=null||(e.accessorials?.length??0)>0;return(0,H.jsxs)(`div`,{style:{display:`flex`,flexDirection:`column`,gap:16},children:[(0,H.jsxs)(S,{children:[(0,H.jsxs)(`div`,{style:{display:`flex`,justifyContent:`space-between`,alignItems:`center`,marginBottom:14},children:[(0,H.jsx)(Z,{children:`Schedule`}),!t&&(0,H.jsxs)(`button`,{onClick:c,style:{background:`none`,border:`1px solid ${s.colors.border}`,borderRadius:8,padding:`5px 12px`,cursor:`pointer`,fontFamily:`inherit`,fontSize:12,fontWeight:600,color:v.textSecondary,display:`inline-flex`,alignItems:`center`,gap:5},children:[(0,H.jsx)(h,{size:12}),` Edit`]})]}),t?(0,H.jsxs)(H.Fragment,{children:[(0,H.jsx)(X,{label:`Service Date`,value:n.localServiceDate,onChange:e=>r(`localServiceDate`,e),type:`date`,icon:(0,H.jsx)(T,{size:11})}),(0,H.jsxs)(`div`,{style:{display:`grid`,gridTemplateColumns:`1fr 1fr`,gap:10},children:[(0,H.jsx)(X,{label:`Window Start`,value:n.windowStartLocal,onChange:e=>r(`windowStartLocal`,e),type:`time`,icon:(0,H.jsx)(C,{size:11})}),(0,H.jsx)(X,{label:`Window End`,value:n.windowEndLocal,onChange:e=>r(`windowEndLocal`,e),type:`time`})]})]}):(0,H.jsxs)(H.Fragment,{children:[(0,H.jsx)(Y,{label:`Service Date`,value:K(e.localServiceDate),icon:(0,H.jsx)(T,{size:11})}),(0,H.jsx)(Y,{label:`Time Window`,value:q(e.windowStartLocal,e.windowEndLocal,e.timezone),icon:(0,H.jsx)(C,{size:11})})]})]}),(0,H.jsxs)(S,{children:[(0,H.jsx)(Z,{children:`Contact`}),t?(0,H.jsxs)(H.Fragment,{children:[(0,H.jsx)(X,{label:`Name`,value:n.contactName,onChange:e=>r(`contactName`,e)}),(0,H.jsx)(X,{label:`Address`,value:n.contactAddress,onChange:e=>r(`contactAddress`,e),icon:(0,H.jsx)(u,{size:11})}),(0,H.jsxs)(`div`,{style:{display:`grid`,gridTemplateColumns:`2fr 1fr 1fr`,gap:10},children:[(0,H.jsx)(X,{label:`City`,value:n.contactCity,onChange:e=>r(`contactCity`,e)}),(0,H.jsx)(X,{label:`State`,value:n.contactState,onChange:e=>r(`contactState`,e)}),(0,H.jsx)(X,{label:`Zip`,value:n.contactZip,onChange:e=>r(`contactZip`,e)})]}),(0,H.jsx)(X,{label:`Phone`,value:n.contactPhone,onChange:e=>r(`contactPhone`,e),type:`tel`,icon:(0,H.jsx)(O,{size:11})}),(0,H.jsx)(X,{label:`Email`,value:n.contactEmail,onChange:e=>r(`contactEmail`,e),type:`email`,icon:(0,H.jsx)(A,{size:11})})]}):(0,H.jsxs)(H.Fragment,{children:[(0,H.jsx)(Y,{label:`Name`,value:e.contactName}),(0,H.jsx)(Y,{label:`Address`,value:m||null,icon:(0,H.jsx)(u,{size:11})}),(0,H.jsx)(Y,{label:`Phone`,value:e.contactPhone,icon:(0,H.jsx)(O,{size:11})}),(0,H.jsx)(Y,{label:`Email`,value:e.contactEmail,icon:(0,H.jsx)(A,{size:11})})]})]}),(0,H.jsxs)(S,{children:[(0,H.jsx)(Z,{children:`Order Details`}),t?(0,H.jsxs)(H.Fragment,{children:[(0,H.jsx)(X,{label:`PO Number`,value:n.poNumber,onChange:e=>r(`poNumber`,e),icon:(0,H.jsx)(ne,{size:11})}),(0,H.jsx)(X,{label:`Sidemark`,value:n.sidemark,onChange:e=>r(`sidemark`,e),icon:(0,H.jsx)(g,{size:11})}),(0,H.jsx)(X,{label:`Client Reference`,value:n.clientReference,onChange:e=>r(`clientReference`,e)}),(0,H.jsx)(X,{label:`Details / Notes`,value:n.details,onChange:e=>r(`details`,e),type:`textarea`,rows:3})]}):(0,H.jsxs)(H.Fragment,{children:[(0,H.jsx)(Y,{label:`Order Type`,value:e.orderType?e.orderType.replace(/_/g,` `):null,icon:(0,H.jsx)(p,{size:11})}),(0,H.jsx)(Y,{label:`PO Number`,value:e.poNumber,icon:(0,H.jsx)(ne,{size:11})}),(0,H.jsx)(Y,{label:`Sidemark`,value:e.sidemark,icon:(0,H.jsx)(g,{size:11})}),(0,H.jsx)(Y,{label:`Client Reference`,value:e.clientReference}),(0,H.jsx)(Y,{label:`Source`,value:e.source}),e.dtDispatchId!=null&&(0,H.jsx)(Y,{label:`Dispatch ID`,value:String(e.dtDispatchId)}),e.details&&(0,H.jsx)(Y,{label:`Details / Notes`,value:e.details})]})]}),(y||t)&&(0,H.jsxs)(S,{children:[(0,H.jsx)(Z,{children:`Pricing`}),t?(0,H.jsxs)(H.Fragment,{children:[(0,H.jsx)(X,{label:`Base Fee`,value:n.baseDeliveryFee,onChange:e=>r(`baseDeliveryFee`,e),type:`number`}),(0,H.jsx)(X,{label:`Order Total`,value:n.orderTotal,onChange:e=>r(`orderTotal`,e),type:`number`,icon:(0,H.jsx)(_,{size:11})}),(0,H.jsx)(`div`,{style:{fontSize:11,color:s.colors.textMuted,marginTop:-4,fontStyle:`italic`},children:`Changing either pricing field marks the order as manually overridden.`})]}):(0,H.jsxs)(H.Fragment,{children:[e.baseDeliveryFee!=null&&(0,H.jsxs)(`div`,{style:{display:`flex`,justifyContent:`space-between`,fontSize:13,marginBottom:8},children:[(0,H.jsx)(`span`,{style:{color:v.textSecondary},children:e.isPickup?`Base Pickup Fee`:`Base Delivery Fee`}),(0,H.jsx)(`span`,{style:{fontWeight:600},children:G(e.baseDeliveryFee)})]}),e.extraItemsCount>0&&(0,H.jsxs)(`div`,{style:{display:`flex`,justifyContent:`space-between`,fontSize:13,marginBottom:8},children:[(0,H.jsxs)(`span`,{style:{color:v.textSecondary},children:[`Extra Items (`,e.extraItemsCount,` × $25)`]}),(0,H.jsx)(`span`,{style:{fontWeight:600},children:G(e.extraItemsFee)})]}),e.accessorials?.map((e,t)=>(0,H.jsxs)(`div`,{style:{display:`flex`,justifyContent:`space-between`,fontSize:13,marginBottom:8},children:[(0,H.jsxs)(`span`,{style:{color:v.textSecondary},children:[e.code,e.quantity>1?` × ${e.quantity}`:``]}),(0,H.jsx)(`span`,{style:{fontWeight:600},children:G(e.subtotal)})]},t)),e.fabricProtectionTotal>0&&(0,H.jsxs)(`div`,{style:{display:`flex`,justifyContent:`space-between`,fontSize:13,marginBottom:8},children:[(0,H.jsx)(`span`,{style:{color:v.textSecondary},children:`Fabric Protection`}),(0,H.jsx)(`span`,{style:{fontWeight:600},children:G(e.fabricProtectionTotal)})]}),e.orderTotal!=null&&(0,H.jsxs)(`div`,{style:{display:`flex`,justifyContent:`space-between`,fontSize:14,marginTop:12,paddingTop:12,borderTop:`1px solid ${s.colors.border}`,fontWeight:700,color:v.textPrimary},children:[(0,H.jsxs)(`span`,{style:{display:`inline-flex`,alignItems:`center`,gap:4},children:[(0,H.jsx)(_,{size:13}),`Order Total`,e.pricingOverride&&(0,H.jsx)(`span`,{style:{fontSize:10,fontWeight:600,background:`#FEF3C7`,color:`#B45309`,padding:`1px 6px`,borderRadius:6,marginLeft:6},children:`MANUAL`})]}),(0,H.jsx)(`span`,{children:G(e.orderTotal)})]}),e.pricingNotes&&(0,H.jsx)(`div`,{style:{fontSize:11,color:v.textMuted,marginTop:8,fontStyle:`italic`},children:e.pricingNotes})]})]}),(0,H.jsxs)(S,{children:[(0,H.jsx)(Z,{children:`Review`}),t?(0,H.jsxs)(H.Fragment,{children:[(0,H.jsx)(X,{label:`Review Status`,value:n.reviewStatus,onChange:e=>r(`reviewStatus`,e),type:`select`,options:ve}),(0,H.jsx)(X,{label:`Review Notes`,value:n.reviewNotes,onChange:e=>r(`reviewNotes`,e),type:`textarea`,rows:3})]}):(0,H.jsxs)(H.Fragment,{children:[e.reviewStatus&&e.reviewStatus!==`not_required`&&U[e.reviewStatus]&&(0,H.jsxs)(`div`,{style:{display:`inline-flex`,alignItems:`center`,gap:6,padding:`4px 12px`,borderRadius:12,fontSize:12,fontWeight:600,background:U[e.reviewStatus].bg,color:U[e.reviewStatus].color,marginBottom:12},children:[U[e.reviewStatus].icon,U[e.reviewStatus].label]}),e.createdByRole&&(0,H.jsx)(Y,{label:`Created By`,value:e.createdByRole}),e.reviewNotes&&(0,H.jsx)(Y,{label:`Review Notes`,value:e.reviewNotes}),e.reviewedAt&&(0,H.jsx)(Y,{label:`Reviewed At`,value:new Date(e.reviewedAt).toLocaleString()}),e.pushedToDtAt&&(0,H.jsx)(Y,{label:`Pushed to DT`,value:new Date(e.pushedToDtAt).toLocaleString()}),e.lastSyncedAt&&(0,H.jsx)(Y,{label:`Last Synced`,value:new Date(e.lastSyncedAt).toLocaleString()})]})]}),t&&(0,H.jsx)(S,{style:{background:`#FAFAF9`},children:(0,H.jsxs)(`div`,{style:{display:`flex`,alignItems:`center`,justifyContent:`space-between`,gap:12},children:[(0,H.jsx)(`div`,{style:{fontSize:12,color:o?`#DC2626`:v.textMuted,flex:1,minWidth:0,overflow:`hidden`,textOverflow:`ellipsis`,whiteSpace:`nowrap`},children:o??`Editing — save to persist changes.`}),(0,H.jsxs)(`div`,{style:{display:`flex`,gap:8,flexShrink:0},children:[(0,H.jsxs)(`button`,{onClick:l,disabled:i,style:{background:`#fff`,color:v.textPrimary,border:`1px solid ${s.colors.border}`,cursor:i?`not-allowed`:`pointer`,padding:`8px 16px`,borderRadius:8,fontSize:13,fontWeight:500,opacity:i?.6:1,fontFamily:`inherit`,display:`inline-flex`,alignItems:`center`,gap:5},children:[(0,H.jsx)(d,{size:13}),` Cancel`]}),(0,H.jsxs)(`button`,{onClick:f,disabled:i,style:{background:v.accent,color:`#fff`,border:`none`,cursor:i?`progress`:`pointer`,padding:`8px 16px`,borderRadius:8,fontSize:13,fontWeight:600,opacity:i?.85:1,fontFamily:`inherit`,display:`inline-flex`,alignItems:`center`,gap:6},children:[i&&(0,H.jsx)(a,{size:12,color:`#fff`}),i?`Saving…`:`Save Changes`]})]})]})})]})}function Se({items:e}){return e.length===0?(0,H.jsx)(S,{children:(0,H.jsx)(`div`,{style:{textAlign:`center`,color:v.textMuted,fontSize:13,padding:`24px 0`},children:`No items on this order.`})}):(0,H.jsxs)(S,{children:[(0,H.jsx)(`div`,{style:{display:`flex`,flexDirection:`column`,gap:10},children:e.map((e,t)=>{let n=e.quantity??0,r=e.deliveredQuantity??null,i=e.delivered===!1,a=r!=null&&n>0&&r<n,o=e.delivered===!0||r!=null&&n>0&&r>=n;return(0,H.jsxs)(`div`,{style:{padding:`12px 14px`,borderRadius:10,background:t%2==0?`#FAFAF9`:`#fff`,border:`1px solid ${s.colors.border}`},children:[(0,H.jsxs)(`div`,{style:{display:`flex`,alignItems:`flex-start`,justifyContent:`space-between`,gap:12,marginBottom:6},children:[(0,H.jsx)(`div`,{style:{fontSize:13,fontWeight:600,color:v.textPrimary,flex:1,minWidth:0},children:e.description||`No description`}),o&&(0,H.jsxs)(`span`,{style:{display:`inline-flex`,alignItems:`center`,gap:4,fontSize:11,fontWeight:600,background:`#F0FDF4`,color:`#15803D`,padding:`2px 8px`,borderRadius:10,flexShrink:0},children:[(0,H.jsx)(b,{size:11}),` Delivered`]}),(i||a)&&!o&&(0,H.jsxs)(`span`,{style:{display:`inline-flex`,alignItems:`center`,gap:4,fontSize:11,fontWeight:600,background:`#FEF3C7`,color:`#B45309`,padding:`2px 8px`,borderRadius:10,flexShrink:0},children:[(0,H.jsx)(x,{size:11}),` Short`]})]}),(0,H.jsxs)(`div`,{style:{display:`flex`,gap:16,flexWrap:`wrap`,fontSize:12,color:v.textSecondary},children:[e.dtItemCode&&(0,H.jsxs)(`span`,{children:[(0,H.jsx)(`span`,{style:{fontWeight:600},children:`SKU:`}),` `,e.dtItemCode]}),e.quantity!=null&&(0,H.jsxs)(`span`,{children:[(0,H.jsx)(`span`,{style:{fontWeight:600},children:`Qty:`}),` `,e.quantity]}),e.deliveredQuantity!=null&&(0,H.jsxs)(`span`,{children:[(0,H.jsx)(`span`,{style:{fontWeight:600},children:`Delivered:`}),` `,(0,H.jsx)(`span`,{style:{color:a?`#B45309`:`#15803D`},children:e.deliveredQuantity})]}),e.checkedQuantity!=null&&e.checkedQuantity!==e.deliveredQuantity&&(0,H.jsxs)(`span`,{children:[(0,H.jsx)(`span`,{style:{fontWeight:600},children:`Checked:`}),` `,e.checkedQuantity]}),e.dtLocation&&(0,H.jsxs)(`span`,{children:[(0,H.jsx)(`span`,{style:{fontWeight:600},children:`Location:`}),` `,e.dtLocation]}),e.unitPrice!=null&&e.unitPrice>0&&(0,H.jsxs)(`span`,{children:[(0,H.jsx)(`span`,{style:{fontWeight:600},children:`Amount:`}),` $`,e.unitPrice.toFixed(2)]})]}),e.itemNote&&(0,H.jsxs)(`div`,{style:{fontSize:12,color:`#92400E`,marginTop:6,padding:`6px 8px`,background:`#FFFBEB`,borderRadius:6,borderLeft:`3px solid #F59E0B`},children:[(0,H.jsx)(`span`,{style:{fontWeight:600},children:`Driver note:`}),` `,e.itemNote]}),e.returnCodes&&e.returnCodes.length>0&&(0,H.jsxs)(`div`,{style:{fontSize:11,color:`#991B1B`,marginTop:6,fontWeight:500},children:[`Return codes: `,e.returnCodes.join(`, `)]}),e.notes&&(0,H.jsx)(`div`,{style:{fontSize:11,color:v.textMuted,marginTop:6,fontStyle:`italic`},children:e.notes})]},e.id||t)})}),(0,H.jsx)(`div`,{style:{fontSize:11,color:v.textMuted,marginTop:12,fontStyle:`italic`},children:`Items can't be edited here — cancel and recreate the order to change items.`})]})}function Q(e){if(!e)return`—`;try{return new Date(e).toLocaleString(`en-US`,{month:`short`,day:`numeric`,hour:`numeric`,minute:`2-digit`})}catch{return e}}function $(e){if(e==null)return`—`;if(e<60)return`${e} min`;let t=Math.floor(e/60),n=e%60;return n===0?`${t}h`:`${t}h ${n}m`}function Ce({order:e,notes:r,history:i,photos:a,loading:o}){if(!(e.startedAt||e.finishedAt||e.driverName||e.truckName||e.signatureCapturedAt||e.codAmount!=null||e.dtStatusCode)&&i.length===0&&r.length===0&&a.length===0)return(0,H.jsx)(S,{children:(0,H.jsx)(`div`,{style:{textAlign:`center`,color:v.textMuted,fontSize:13,padding:`24px 0`},children:o?`Loading completion data…`:e.pushedToDtAt?`No driver activity yet. Click "DT Sync" on the Orders page to pull the latest from DispatchTrack.`:`This order hasn't been pushed to DispatchTrack yet.`})});let c=e.actualServiceTimeMinutes;return(0,H.jsxs)(`div`,{style:{display:`flex`,flexDirection:`column`,gap:16},children:[(e.driverName||e.truckName||e.serviceUnit||e.stopNumber!=null)&&(0,H.jsxs)(S,{children:[(0,H.jsx)(Z,{children:`Driver & Vehicle`}),(0,H.jsx)(Y,{label:`Driver`,value:e.driverName||null,icon:(0,H.jsx)(t,{size:11})}),(0,H.jsx)(Y,{label:`Truck`,value:e.truckName?`${e.truckName}${e.truckId?` (#${e.truckId})`:``}`:null,icon:(0,H.jsx)(p,{size:11})}),(0,H.jsx)(Y,{label:`Service Unit`,value:e.serviceUnit||null}),(0,H.jsx)(Y,{label:`Stop #`,value:e.stopNumber==null?null:String(e.stopNumber)})]}),(0,H.jsxs)(S,{children:[(0,H.jsx)(Z,{children:`Timing`}),(0,H.jsx)(Y,{label:`Scheduled`,value:Q(e.scheduledAt),icon:(0,H.jsx)(T,{size:11})}),(0,H.jsx)(Y,{label:`Started`,value:Q(e.startedAt),icon:(0,H.jsx)(C,{size:11})}),(0,H.jsx)(Y,{label:`Finished`,value:Q(e.finishedAt),icon:(0,H.jsx)(b,{size:11})}),c!=null&&(0,H.jsx)(Y,{label:`Actual Service Time`,value:$(c),icon:(0,H.jsx)(j,{size:11})}),e.dtStatusCode&&(0,H.jsx)(Y,{label:`DT Status Code`,value:e.dtStatusCode})]}),(e.codAmount!=null||e.paymentCollected||e.signatureCapturedAt)&&(0,H.jsxs)(S,{children:[(0,H.jsx)(Z,{children:`Proof of Delivery`}),e.codAmount!=null&&(0,H.jsx)(Y,{label:`COD Amount`,value:G(e.codAmount),icon:(0,H.jsx)(_,{size:11})}),e.paymentCollected&&(0,H.jsx)(Y,{label:`Payment Collected`,value:`Yes`,icon:(0,H.jsx)(_,{size:11})}),e.paymentNotes&&(0,H.jsx)(Y,{label:`Payment Notes`,value:e.paymentNotes}),e.signatureCapturedAt&&(0,H.jsx)(Y,{label:`Signature Captured`,value:Q(e.signatureCapturedAt),icon:(0,H.jsx)(ue,{size:11})})]}),a.length>0&&(0,H.jsxs)(S,{children:[(0,H.jsxs)(Z,{children:[`POD Photos (`,a.length,`)`]}),(0,H.jsx)(`div`,{style:{display:`grid`,gridTemplateColumns:`repeat(auto-fill, minmax(140px, 1fr))`,gap:10},children:a.map(e=>(0,H.jsxs)(`a`,{href:e.fullUrl??`#`,target:`_blank`,rel:`noopener noreferrer`,style:{display:`block`,borderRadius:8,overflow:`hidden`,border:`1px solid ${s.colors.border}`,background:`#FAFAF9`,textDecoration:`none`,color:`inherit`},title:e.capturedAt?Q(e.capturedAt):e.dtImageName,onClick:t=>{e.fullUrl||t.preventDefault()},children:[e.thumbnailUrl?(0,H.jsx)(`img`,{src:e.thumbnailUrl,alt:e.dtImageName,loading:`lazy`,style:{width:`100%`,height:120,objectFit:`cover`,display:`block`}}):(0,H.jsx)(`div`,{style:{width:`100%`,height:120,display:`flex`,alignItems:`center`,justifyContent:`center`,fontSize:11,color:v.textMuted},children:e.fetchError?`Fetch failed`:`Loading…`}),e.capturedAt&&(0,H.jsx)(`div`,{style:{fontSize:10,color:v.textMuted,padding:`4px 6px`,borderTop:`1px solid ${s.colors.border}`},children:Q(e.capturedAt)})]},e.id))})]}),r.length>0&&(0,H.jsxs)(S,{children:[(0,H.jsx)(Z,{children:(0,H.jsxs)(`span`,{style:{display:`inline-flex`,alignItems:`center`,gap:6},children:[(0,H.jsx)(k,{size:11}),` DT Notes (`,r.length,`)`]})}),(0,H.jsx)(`div`,{style:{display:`flex`,flexDirection:`column`,gap:8},children:r.map(e=>(0,H.jsxs)(`div`,{style:{padding:`8px 10px`,background:`#F8FAFC`,borderRadius:8,border:`1px solid ${s.colors.border}`},children:[(0,H.jsx)(`div`,{style:{fontSize:12,color:v.textPrimary,whiteSpace:`pre-wrap`},children:e.body}),(0,H.jsxs)(`div`,{style:{fontSize:10,color:v.textMuted,marginTop:4},children:[e.authorName||`DispatchTrack`,e.authorType&&e.authorType!==`system`?` · ${e.authorType}`:``,e.createdAtDt?` · ${Q(e.createdAtDt)}`:``]})]},e.id))})]}),i.length>0&&(0,H.jsxs)(S,{children:[(0,H.jsx)(Z,{children:(0,H.jsxs)(`span`,{style:{display:`inline-flex`,alignItems:`center`,gap:6},children:[(0,H.jsx)(n,{size:11}),` Driver Activity (`,i.length,`)`]})}),(0,H.jsx)(`div`,{style:{display:`flex`,flexDirection:`column`,gap:6},children:i.map(e=>(0,H.jsxs)(`div`,{style:{display:`flex`,gap:10,padding:`6px 0`,borderBottom:`1px solid ${s.colors.border}`},children:[(0,H.jsx)(`div`,{style:{fontSize:11,color:v.textMuted,flexShrink:0,width:100},children:Q(e.happenedAt)}),(0,H.jsxs)(`div`,{style:{fontSize:12,color:v.textPrimary,flex:1},children:[e.description||(e.code==null?`Event`:`Event ${e.code}`),e.ownerName&&(0,H.jsxs)(`span`,{style:{color:v.textMuted,marginLeft:6,fontSize:11},children:[`· `,e.ownerName]}),e.lat!=null&&e.lng!=null&&(0,H.jsxs)(`a`,{href:`https://www.google.com/maps?q=${e.lat},${e.lng}`,target:`_blank`,rel:`noopener noreferrer`,style:{marginLeft:6,fontSize:11,color:v.accent,textDecoration:`none`},children:[(0,H.jsx)(u,{size:10,style:{verticalAlign:`middle`}}),` map`]})]})]},e.id))})]})]})}function we(){let{orderId:t}=c(),n=o(),{user:r}=i(),a=r?.role===`admin`||r?.role===`staff`,{order:l,status:u,error:d,refetch:f}=de(t),[p,m]=(0,M.useState)(null);(0,M.useEffect)(()=>{l&&m(l)},[l]);let h=p??l,[g,_]=(0,M.useState)(!1),[v,y]=(0,M.useState)(()=>W(h||{})),[b,C]=(0,M.useState)(!1),[ne,T]=(0,M.useState)(null),[ae,O]=(0,M.useState)([]),[k,ue]=(0,M.useState)([]),[A,j]=(0,M.useState)([]),[N,P]=(0,M.useState)(!1);(0,M.useEffect)(()=>{if(!h?.id)return;let e=!1;return P(!0),Promise.all([oe(h.id),se(h.id),ce(h.id)]).then(([t,n,r])=>{e||(O(t),ue(n),j(r))}).finally(()=>{e||P(!1)}),()=>{e=!0}},[h?.id,h?.lastSyncedAt]);let F=(0,M.useCallback)(async e=>{if(!h)return;let t=e===`rejected`?`Reason for rejecting (will be emailed to the submitter):`:`What revisions are needed? (will be emailed to the submitter):`,n=window.prompt(t,h.reviewNotes||``);if(n!==null){C(!0),T(null);try{let{data:t}=await E.auth.getUser(),r=t?.user?.id??null,i=`Stride Reviewer`;if(r){let{data:e}=await E.from(`profiles`).select(`display_name, email`).eq(`id`,r).maybeSingle();i=e?.display_name||e?.email||i}let{error:a}=await E.from(`dt_orders`).update({review_status:e,review_notes:n.trim()||null,reviewed_by:r,reviewed_at:new Date().toISOString()}).eq(`id`,h.id);if(a)throw a;try{let{data:t,error:r}=await E.functions.invoke(`notify-order-revision`,{body:{orderId:h.id,action:e,reviewerName:i,reviewNotes:n.trim()}});r?console.warn(`[OrderPage] notify-order-revision invoke error:`,r.message):t&&t.ok===!1&&console.warn(`[OrderPage] notify-order-revision returned ok:false`,t)}catch(e){console.warn(`[OrderPage] notify-order-revision threw`,e)}let o=await D(h.id);o&&m(o),f()}catch(e){T(e instanceof Error?e.message:String(e))}finally{C(!1)}}},[h,f]),[pe,I]=(0,M.useState)(!1),[L,R]=(0,M.useState)(!1),[z,B]=(0,M.useState)(null),[me,V]=(0,M.useState)(!1);(0,M.useEffect)(()=>{h&&!g&&y(W(h))},[h,g]);let he=(0,M.useCallback)((e,t)=>{y(n=>({...n,[e]:t}))},[]),ge=(0,M.useCallback)(()=>{h&&y(W(h)),T(null),_(!0)},[h]),ve=(0,M.useCallback)(()=>{_(!1),T(null)},[]),G=(0,M.useCallback)(async()=>{if(h){C(!0),T(null);try{let{data:e}=await E.auth.getUser(),t=e?.user?.id??null,n={contact_name:v.contactName.trim()||null,contact_address:v.contactAddress.trim()||null,contact_city:v.contactCity.trim()||null,contact_state:v.contactState.trim()||null,contact_zip:v.contactZip.trim()||null,contact_phone:v.contactPhone.trim()||null,contact_email:v.contactEmail.trim()||null,local_service_date:v.localServiceDate||null,window_start_local:v.windowStartLocal||null,window_end_local:v.windowEndLocal||null,po_number:v.poNumber.trim()||null,sidemark:v.sidemark.trim()||null,client_reference:v.clientReference.trim()||null,details:v.details.trim()||null,review_status:v.reviewStatus,review_notes:v.reviewNotes.trim()||null,reviewed_by:t,reviewed_at:new Date().toISOString()},r=v.orderTotal===``?null:Number(v.orderTotal),i=v.baseDeliveryFee===``?null:Number(v.baseDeliveryFee);(r!==h.orderTotal||i!==h.baseDeliveryFee)&&(n.order_total=r,n.base_delivery_fee=i,n.pricing_override=!0);let{error:a}=await E.from(`dt_orders`).update(n).eq(`id`,h.id);if(a)throw a;if((v.reviewStatus===`revision_requested`||v.reviewStatus===`rejected`)&&v.reviewStatus!==h.reviewStatus){let e=`Stride Reviewer`;if(t){let{data:n}=await E.from(`profiles`).select(`display_name, email`).eq(`id`,t).maybeSingle();e=n?.display_name||n?.email||e}try{let{data:t,error:n}=await E.functions.invoke(`notify-order-revision`,{body:{orderId:h.id,action:v.reviewStatus,reviewerName:e,reviewNotes:v.reviewNotes.trim()}});n?console.warn(`[OrderPage] notify-order-revision invoke error:`,n.message):t&&t.ok===!1&&console.warn(`[OrderPage] notify-order-revision returned ok:false`,t)}catch(e){console.warn(`[OrderPage] notify-order-revision threw`,e)}}_(!1);let o=await D(h.id);o&&m(o),f()}catch(e){T(e instanceof Error?e.message:String(e))}finally{C(!1)}}},[h,v,f]);if(u===`loading`)return(0,H.jsxs)(`div`,{style:{display:`flex`,flexDirection:`column`,alignItems:`center`,justifyContent:`center`,height:`100%`,gap:16,color:s.colors.textMuted},children:[(0,H.jsx)(e,{size:32,style:{animation:`spin 1s linear infinite`}}),(0,H.jsx)(`div`,{style:{fontSize:14},children:`Loading order…`}),(0,H.jsx)(`style`,{children:`@keyframes spin { to { transform: rotate(360deg) } }`})]});if(u===`not-found`)return(0,H.jsx)(be,{icon:le,color:s.colors.textMuted,title:`Order Not Found`,body:`No order found with this ID.`,actions:(0,H.jsx)(`button`,{onClick:()=>n(`/orders`),style:ye,children:`Back to Orders`})});if(u===`error`)return(0,H.jsx)(be,{icon:x,color:s.colors.statusRed,title:`Failed to Load Order`,body:d||`An unexpected error occurred.`,actions:(0,H.jsxs)(`div`,{style:{display:`flex`,gap:12},children:[(0,H.jsx)(`button`,{onClick:f,style:{...ye,color:s.colors.primary},children:`Retry`}),(0,H.jsx)(`button`,{onClick:()=>n(`/orders`),style:ye,children:`Back to Orders`})]})});if(!h)return null;let K=_e[h.statusCategory]||_e.open,q=h.reviewStatus&&h.reviewStatus!==`not_required`?U[h.reviewStatus]:null,J=(0,H.jsxs)(`span`,{style:{display:`inline-flex`,alignItems:`center`,gap:6,flexWrap:`wrap`},children:[h.isPickup&&(0,H.jsx)(`span`,{style:{fontSize:10,fontWeight:700,background:`#FEF3C7`,color:`#B45309`,padding:`2px 8px`,borderRadius:10,letterSpacing:`1px`,textTransform:`uppercase`},children:`PICKUP`}),(0,H.jsx)(`span`,{style:{fontSize:12,fontWeight:600,background:K.bg,color:K.color,padding:`3px 10px`,borderRadius:12},children:h.statusName||K.label}),q&&(0,H.jsxs)(`span`,{style:{fontSize:12,fontWeight:600,background:q.bg,color:q.color,padding:`3px 10px`,borderRadius:12,display:`inline-flex`,alignItems:`center`,gap:4},children:[q.icon,q.label]})]}),Y=[{id:`details`,label:`Details`,keepMounted:!0,render:()=>(0,H.jsx)(xe,{order:h,editing:g,edit:v,setField:he,saving:b,saveError:ne,onStartEdit:ge,onCancelEdit:ve,onSave:G})},{id:`items`,label:`Items`,badgeCount:h.items?.length??0,render:()=>(0,H.jsx)(Se,{items:h.items??[]})},{id:`completion`,label:`Completion`,badgeCount:k.length>0?k.length:void 0,render:()=>(0,H.jsx)(Ce,{order:h,notes:k,history:ae,photos:A,loading:N})},{id:`activity`,label:`Activity`,render:()=>(0,H.jsx)(S,{children:(0,H.jsx)(re,{entityType:`dt_order`,entityId:h.id,tenantId:h.tenantId??void 0})})}],X=(()=>{let e=new Set,t=[];for(let n of h.items??[])!n.inventoryId||e.has(n.inventoryId)||(e.add(n.inventoryId),t.push(n));return t})(),Z=h.statusCategory===`completed`&&!!h.tenantId&&X.length>0,Q=g?null:(0,H.jsx)(w,{label:`Print PDF`,variant:`secondary`,onClick:()=>fe(h)},`print-pdf`),$=a&&!g?(0,H.jsxs)(H.Fragment,{children:[Q,(0,H.jsx)(w,{label:`Edit Full Order`,variant:`secondary`,onClick:()=>I(!0)}),Z&&(0,H.jsx)(w,{label:`Release Items`,variant:`primary`,onClick:()=>V(!0)}),(h.reviewStatus===`pending_review`||h.reviewStatus===`revision_requested`)&&(0,H.jsxs)(H.Fragment,{children:[(0,H.jsx)(w,{label:`Approve`,variant:`primary`,onClick:async()=>{await E.from(`dt_orders`).update({review_status:`approved`,reviewed_at:new Date().toISOString()}).eq(`id`,h.id);let e=await D(h.id);e&&m(e),f()}}),(0,H.jsx)(w,{label:`Request Revision`,variant:`secondary`,onClick:()=>F(`revision_requested`)}),(0,H.jsx)(w,{label:`Reject`,variant:`secondary`,onClick:()=>F(`rejected`)})]}),h.reviewStatus===`approved`&&!h.pushedToDtAt&&(0,H.jsx)(w,{label:L?`Pushing…`:`Push to DT`,variant:`primary`,onClick:async()=>{if(!L){R(!0),B(null);try{let{data:e,error:t}=await E.functions.invoke(`dt-push-order`,{body:{orderId:h.id}});if(t){let e=t.message;try{let n=t.context;if(n?.json){let t=await n.json();t?.error&&(e=t.error,t.responseBody&&(e+=` (DT response: ${t.responseBody.slice(0,200)})`))}}catch{}throw Error(e)}let n=e;if(!n?.ok)throw Error(n?.error||`DT push failed`);let r=await D(h.id);r&&m(r),f()}catch(e){let t=e instanceof Error?e.message:String(e);console.error(`[OrderPage] DT push failed:`,t,e),B(t)}finally{R(!1)}}}})]}):Q,we=$!==null&&M.Children.count($)>0;return(0,H.jsxs)(H.Fragment,{children:[z&&(0,H.jsxs)(`div`,{role:`alert`,style:{position:`fixed`,top:16,left:`50%`,transform:`translateX(-50%)`,zIndex:1100,padding:`14px 18px`,background:`#FEF2F2`,border:`1px solid #FCA5A5`,color:`#991B1B`,borderRadius:10,fontSize:13,maxWidth:720,boxShadow:`0 8px 24px rgba(0,0,0,0.15)`,display:`flex`,alignItems:`flex-start`,gap:10},children:[(0,H.jsxs)(`div`,{style:{flex:1,minWidth:0},children:[(0,H.jsx)(`div`,{style:{fontWeight:700,marginBottom:4},children:`DT push failed`}),(0,H.jsx)(`div`,{style:{fontWeight:400,whiteSpace:`pre-wrap`,wordBreak:`break-word`},children:z})]}),(0,H.jsx)(`button`,{onClick:()=>B(null),style:{background:`none`,border:`none`,cursor:`pointer`,color:`#991B1B`,fontWeight:700,fontSize:18,lineHeight:1,padding:0,flexShrink:0},"aria-label":`Dismiss`,children:`×`})]}),(0,H.jsx)(ee,{entityLabel:`ORDER`,entityId:h.dtIdentifier||h.id.slice(0,8).toUpperCase(),statusBadge:J,clientName:h.clientName||void 0,tabs:Y,initialTabId:`details`,footer:we?$:void 0}),pe&&(0,H.jsx)(te,{editOrderId:h.id,onClose:()=>I(!1),onSubmit:async()=>{I(!1);let e=await D(h.id);e&&m(e),f()}}),me&&h.tenantId&&(0,H.jsx)(ie,{itemIds:X.map(e=>e.inventoryId),clientName:h.clientName||`this client`,clientSheetId:h.tenantId,defaultReleaseDate:h.finishedAt?h.finishedAt.slice(0,10):void 0,selectableItems:X.map(e=>({id:e.inventoryId,label:e.description||e.dtItemCode||`Item`,sublabel:[e.dtItemCode&&`SKU ${e.dtItemCode}`,e.quantity!=null&&`Qty ${e.quantity}`].filter(Boolean).join(` · `)||void 0})),onClose:()=>V(!1),onSuccess:async()=>{let e=await D(h.id);e&&m(e),f()}})]})}export{we as OrderPage};