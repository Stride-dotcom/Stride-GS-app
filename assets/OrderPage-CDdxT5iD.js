import{$ as e,Dt as t,Et as n,H as r,It as i,L as a,Lt as o,M as s,Q as c,R as l,Ut as u,V as d,Vt as f,Z as p,d as m,et as ee,f as h,ft as g,i as _,k as v,l as y,m as te,n as ne,ot as b,p as re,pt as x,rt as S,t as ie,u as C,ut as w,wt as ae,yt as T,z as oe}from"./ReleaseItemsModal-Ck-TxBNd.js";import{K as E,d as se,f as ce,p as le,u as D}from"./supabaseQueries-Fhi4C-_n.js";import{t as O}from"./phone-1P7XyGPk.js";import{t as ue}from"./search-x-B5Xc7mss.js";import{D as k,O as de,k as A}from"./index-8KNNhlJN.js";var j=ae(`clock-3`,[[`circle`,{cx:`12`,cy:`12`,r:`10`,key:`1mglay`}],[`path`,{d:`M12 6v6h4`,key:`135r8i`}]]),M=u(f(),1);function fe(e){let{clients:t}=v(),[n,r]=(0,M.useState)(null),[i,a]=(0,M.useState)(`loading`),[o,c]=(0,M.useState)(null),l=(0,M.useRef)(null),u=(0,M.useRef)(0),d=(0,M.useMemo)(()=>{let e={};for(let n of t)e[n.id]=n.name;return e},[t]),f=(0,M.useRef)(d);f.current=d;let p=(0,M.useCallback)(async()=>{if(!e)return;l.current?.abort();let t=new AbortController;l.current=t;let n=++u.current;a(`loading`),c(null);try{let i=await D(e,f.current);if(t.signal.aborted||n!==u.current)return;if(!i){a(`not-found`);return}r(i),a(`loaded`)}catch(e){if(t.signal.aborted||n!==u.current)return;c(e instanceof Error?e.message:`Failed to load order`),a(`error`)}},[e]);return(0,M.useEffect)(()=>(p(),()=>{l.current?.abort()}),[p]),(0,M.useEffect)(()=>{if(e)return s.subscribe((t,n)=>{t===`order`&&n===e&&p()})},[e,p]),{order:n,status:i,error:o,refetch:p}}function pe(e){let t=_e(e),n=window.open(``,`_blank`);if(!n){alert(`Please allow pop-ups for this site, then try again.`);return}n.document.open(),n.document.write(t),n.document.close(),setTimeout(()=>{try{n.print()}catch{}},450)}function N(e){return e==null?`—`:`$`+e.toLocaleString(`en-US`,{minimumFractionDigits:2,maximumFractionDigits:2})}function P(e){if(!e)return`—`;try{return new Date(e+`T00:00:00`).toLocaleDateString(`en-US`,{weekday:`short`,month:`short`,day:`numeric`,year:`numeric`})}catch{return e}}function F(e){if(!e)return`—`;try{return new Date(e).toLocaleString(`en-US`)}catch{return e}}function me(e,t,n){if(!e&&!t)return`—`;let r=e=>{let[t,n]=e.split(`:`),r=parseInt(t);if(Number.isNaN(r))return e;let i=r>=12?`PM`:`AM`;return r===0?r=12:r>12&&(r-=12),`${r}:${n} ${i}`};return[e&&r(e),t&&r(t)].filter(Boolean).join(` – `)+(n===`America/Los_Angeles`?` PT`:n?` (${n})`:``)}function I(e){return e==null?``:String(e).replace(/&/g,`&amp;`).replace(/</g,`&lt;`).replace(/>/g,`&gt;`).replace(/"/g,`&quot;`).replace(/'/g,`&#39;`)}function L(e,t){return!t||t===`—`?``:`<tr><th>${I(e)}</th><td>${I(t)}</td></tr>`}function R(e){let t=me(e.windowStartLocal,e.windowEndLocal,e.timezone),n=[L(`Service Date`,P(e.localServiceDate)),L(`Time Window`,t),L(`Order Type`,e.orderType?e.orderType.replace(/_/g,` `):null),L(`Scheduled`,F(e.scheduledAt)),L(`Started`,F(e.startedAt)),L(`Finished`,F(e.finishedAt))].filter(Boolean).join(``);return n?`<section><h2>Schedule</h2><table class="kv">${n}</table></section>`:``}function z(e){let t=[e.contactAddress,e.contactCity,e.contactState,e.contactZip].filter(Boolean).join(`, `),n=[L(`Name`,e.contactName),L(`Address`,t),L(`Phone`,e.contactPhone),L(`Email`,e.contactEmail)].filter(Boolean).join(``);return n?`<section><h2>${e.isPickup?`Pickup Contact`:`Delivery Contact`}</h2><table class="kv">${n}</table></section>`:``}function B(e){let t=[L(`PO Number`,e.poNumber),L(`Sidemark`,e.sidemark),L(`Client Reference`,e.clientReference),L(`Source`,e.source),e.dtDispatchId==null?``:L(`Dispatch ID`,String(e.dtDispatchId))].filter(Boolean).join(``),n=e.details?`<div class="notes-block"><div class="notes-label">Details / Notes</div><div class="notes-body">${I(e.details)}</div></div>`:``;return!t&&!n?``:`<section><h2>Order Details</h2>${t?`<table class="kv">${t}</table>`:``}${n}</section>`}function he(e){let t=[L(`Driver`,e.driverName),e.truckName?L(`Truck`,e.truckName):``,e.serviceUnit?L(`Service Unit`,e.serviceUnit):``,e.stopNumber==null?``:L(`Stop #`,String(e.stopNumber)),e.actualServiceTimeMinutes==null?``:L(`Service Time`,`${e.actualServiceTimeMinutes} min`),e.codAmount==null?``:L(`COD Amount`,N(e.codAmount)),e.signatureCapturedAt?L(`Signature Captured`,F(e.signatureCapturedAt)):``].filter(Boolean).join(``);return t?`<section><h2>Driver &amp; Route</h2><table class="kv">${t}</table></section>`:``}function V(e){return!e.items||e.items.length===0?`<section><h2>Items</h2><div class="empty">No items on this order.</div></section>`:`<section>
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
  </section>`}function ge(e){if(!(e.baseDeliveryFee!=null||e.orderTotal!=null||(e.accessorials?.length??0)>0||e.extraItemsCount>0||e.fabricProtectionTotal>0))return``;let t=[];if(e.baseDeliveryFee!=null&&t.push(`<tr><td>${e.isPickup?`Base Pickup Fee`:`Base Delivery Fee`}</td><td class="num">${N(e.baseDeliveryFee)}</td></tr>`),e.extraItemsCount>0&&t.push(`<tr><td>Extra Items (${e.extraItemsCount} × $25)</td><td class="num">${N(e.extraItemsFee)}</td></tr>`),e.accessorials?.length)for(let n of e.accessorials){let e=n.code+(n.quantity>1?` × ${n.quantity}`:``);t.push(`<tr><td>${I(e)}</td><td class="num">${N(n.subtotal)}</td></tr>`)}e.fabricProtectionTotal>0&&t.push(`<tr><td>Fabric Protection</td><td class="num">${N(e.fabricProtectionTotal)}</td></tr>`);let n=e.orderTotal==null?``:`<tr class="total-row"><td>Order Total${e.pricingOverride?` <span class="manual-badge">MANUAL</span>`:``}</td><td class="num">${N(e.orderTotal)}</td></tr>`,r=e.pricingNotes?`<div class="pricing-notes">${I(e.pricingNotes)}</div>`:``;return`<section>
    <h2>Pricing</h2>
    <table class="totals">${t.join(``)}${n}</table>
    ${r}
  </section>`}function _e(e){let t=e.dtIdentifier||e.id.slice(0,8).toUpperCase(),n=e.statusName||e.statusCode||`—`,r=new Date().toLocaleString(`en-US`),i=e.isPickup?`Pickup Order`:`Delivery Order`,a=[R(e),z(e),B(e),V(e),ge(e),he(e)].filter(Boolean).join(``);return`<!DOCTYPE html>
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
      background: #fff;
      color: #1C1C1C;
      font-size: 12.5px;
      line-height: 1.55;
    }

    /* Printer-friendly header — white background, dark text, no
       ink-heavy block. Real Stride logo image (absolute URL so the
       about:blank popup can fetch it from GitHub Pages). */
    .print-header {
      background: #fff;
      color: #1C1C1C;
      padding: 18px 32px 14px;
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      border-bottom: 2px solid #1C1C1C;
      max-width: 820px;
      margin: 0 auto;
    }
    .header-brand { display: flex; align-items: center; gap: 12px; }
    .header-logo {
      width: 44px; height: 44px;
      object-fit: contain;
      display: block;
    }
    .header-name { font-size: 16px; font-weight: 800; letter-spacing: 2.5px; color: #1C1C1C; }
    .header-sub  { font-size: 10px; letter-spacing: 1.5px; color: #64748B; margin-top: 2px; }
    .header-meta { text-align: right; font-size: 11px; color: #64748B; line-height: 1.5; }
    .header-meta strong { color: #1C1C1C; font-size: 13px; }
    .header-id { color: #E8692A; font-size: 18px; font-weight: 700; letter-spacing: 0.5px; }

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
      body { background: #fff; }
      section { break-inside: avoid; }
      table.items tr { break-inside: avoid; }
      @page { margin: 0.4in; size: letter; }
    }
  </style>
</head>
<body>
  <div class="print-header">
    <div class="header-brand">
      <img class="header-logo" src="https://www.mystridehub.com/stride-logo.png" alt="Stride Logistics" />
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
</html>`}var H=t(),ve={open:{bg:`#EFF6FF`,color:`#1D4ED8`,label:`Open`},in_progress:{bg:`#EDE9FE`,color:`#7C3AED`,label:`In Progress`},completed:{bg:`#F0FDF4`,color:`#15803D`,label:`Completed`},exception:{bg:`#FEF2F2`,color:`#DC2626`,label:`Exception`},cancelled:{bg:`#F3F4F6`,color:`#6B7280`,label:`Cancelled`}},U={pending_review:{bg:`#FEF3C7`,color:`#B45309`,label:`Pending Review`,icon:(0,H.jsx)(j,{size:11})},approved:{bg:`#DCFCE7`,color:`#166534`,label:`Approved`,icon:(0,H.jsx)(g,{size:11})},rejected:{bg:`#FEE2E2`,color:`#991B1B`,label:`Rejected`,icon:(0,H.jsx)(x,{size:11})},revision_requested:{bg:`#FEF3C7`,color:`#92400E`,label:`Revision Needed`,icon:(0,H.jsx)(x,{size:11})}},ye=[{value:`pending_review`,label:`Pending Review`},{value:`approved`,label:`Approved`},{value:`rejected`,label:`Rejected`},{value:`revision_requested`,label:`Revision Requested`},{value:`not_required`,label:`Not Required`}];function W(e){return{contactName:e.contactName??``,contactAddress:e.contactAddress??``,contactCity:e.contactCity??``,contactState:e.contactState??``,contactZip:e.contactZip??``,contactPhone:e.contactPhone??``,contactEmail:e.contactEmail??``,localServiceDate:e.localServiceDate??``,windowStartLocal:(e.windowStartLocal??``).slice(0,5),windowEndLocal:(e.windowEndLocal??``).slice(0,5),poNumber:e.poNumber??``,sidemark:e.sidemark??``,clientReference:e.clientReference??``,details:e.details??``,orderTotal:e.orderTotal==null?``:String(e.orderTotal),baseDeliveryFee:e.baseDeliveryFee==null?``:String(e.baseDeliveryFee),reviewStatus:e.reviewStatus??`pending_review`,reviewNotes:e.reviewNotes??``}}function G(e){return`$${e.toFixed(2)}`}function K(e){if(!e)return`—`;try{return new Date(e+`T00:00:00`).toLocaleDateString(`en-US`,{weekday:`short`,month:`short`,day:`numeric`,year:`numeric`})}catch{return e}}function q(e,t,n){if(!e&&!t)return`—`;let r=e=>{let[t,n]=e.split(`:`),r=parseInt(t),i=r>=12?`PM`:`AM`;return r===0?r=12:r>12&&(r-=12),`${r}:${n} ${i}`};return[e&&r(e),t&&r(t)].filter(Boolean).join(` – `)+(n===`America/Los_Angeles`?` PT`:n?` (${n})`:``)}var J={width:`100%`,padding:`7px 10px`,fontSize:13,border:`1px solid ${l.colors.border}`,borderRadius:8,outline:`none`,fontFamily:`inherit`,boxSizing:`border-box`,background:`#fff`};function Y({label:e,value:t,icon:n}){return t?(0,H.jsxs)(`div`,{style:{marginBottom:14},children:[(0,H.jsx)(h,{children:n?(0,H.jsxs)(`span`,{style:{display:`inline-flex`,alignItems:`center`,gap:4},children:[n,e]}):e}),(0,H.jsx)(`div`,{style:{fontSize:13,color:y.textPrimary,lineHeight:1.5},children:t})]}):null}function X({label:e,value:t,onChange:n,type:r=`text`,rows:i,options:a,icon:o}){return(0,H.jsxs)(`div`,{style:{marginBottom:12},children:[(0,H.jsx)(h,{children:o?(0,H.jsxs)(`span`,{style:{display:`inline-flex`,alignItems:`center`,gap:4},children:[o,e]}):e}),r===`textarea`?(0,H.jsx)(`textarea`,{value:t,onChange:e=>n(e.target.value),rows:i??3,style:{...J,resize:`vertical`}}):r===`select`?(0,H.jsx)(`select`,{value:t,onChange:e=>n(e.target.value),style:J,children:a.map(e=>(0,H.jsx)(`option`,{value:e.value,children:e.label},e.value))}):(0,H.jsx)(`input`,{type:r,value:t,onChange:e=>n(e.target.value),style:J})]})}function Z({children:e}){return(0,H.jsx)(`div`,{style:{fontSize:10,fontWeight:700,color:y.textMuted,textTransform:`uppercase`,letterSpacing:`2px`,marginBottom:14,paddingBottom:8,borderBottom:`1px solid ${l.colors.border}`},children:e})}var be={display:`inline-flex`,alignItems:`center`,gap:6,padding:`${l.spacing.sm} ${l.spacing.lg}`,borderRadius:l.radii.lg,border:`1px solid ${l.colors.border}`,background:l.colors.bgCard,color:l.colors.text,fontSize:l.typography.sizes.base,fontWeight:l.typography.weights.medium,cursor:`pointer`,fontFamily:`inherit`};function xe({icon:e,color:t,title:n,body:r,actions:i}){return(0,H.jsxs)(`div`,{style:{display:`flex`,flexDirection:`column`,alignItems:`center`,justifyContent:`center`,height:`100%`,gap:16,padding:32,textAlign:`center`},children:[(0,H.jsx)(e,{size:48,color:t}),(0,H.jsx)(`div`,{style:{fontSize:18,fontWeight:600,color:l.colors.text},children:n}),(0,H.jsx)(`div`,{style:{fontSize:14,color:l.colors.textMuted,maxWidth:400},children:r}),i]})}function Se({order:t,editing:n,edit:i,setField:o,saving:s,saveError:u,onStartEdit:d,onCancelEdit:f,onSave:m}){let ee=[t.contactAddress,t.contactCity,t.contactState,t.contactZip].filter(Boolean).join(`, `),h=t.baseDeliveryFee!=null||t.orderTotal!=null||(t.accessorials?.length??0)>0;return(0,H.jsxs)(`div`,{style:{display:`flex`,flexDirection:`column`,gap:16},children:[(0,H.jsxs)(C,{children:[(0,H.jsxs)(`div`,{style:{display:`flex`,justifyContent:`space-between`,alignItems:`center`,marginBottom:14},children:[(0,H.jsx)(Z,{children:`Schedule`}),!n&&(0,H.jsxs)(`button`,{onClick:d,style:{background:`none`,border:`1px solid ${l.colors.border}`,borderRadius:8,padding:`5px 12px`,cursor:`pointer`,fontFamily:`inherit`,fontSize:12,fontWeight:600,color:y.textSecondary,display:`inline-flex`,alignItems:`center`,gap:5},children:[(0,H.jsx)(p,{size:12}),` Edit`]})]}),n?(0,H.jsxs)(H.Fragment,{children:[(0,H.jsx)(X,{label:`Service Date`,value:i.localServiceDate,onChange:e=>o(`localServiceDate`,e),type:`date`,icon:(0,H.jsx)(T,{size:11})}),(0,H.jsxs)(`div`,{style:{display:`grid`,gridTemplateColumns:`1fr 1fr`,gap:10},children:[(0,H.jsx)(X,{label:`Window Start`,value:i.windowStartLocal,onChange:e=>o(`windowStartLocal`,e),type:`time`,icon:(0,H.jsx)(w,{size:11})}),(0,H.jsx)(X,{label:`Window End`,value:i.windowEndLocal,onChange:e=>o(`windowEndLocal`,e),type:`time`})]})]}):(0,H.jsxs)(H.Fragment,{children:[(0,H.jsx)(Y,{label:`Service Date`,value:K(t.localServiceDate),icon:(0,H.jsx)(T,{size:11})}),(0,H.jsx)(Y,{label:`Time Window`,value:q(t.windowStartLocal,t.windowEndLocal,t.timezone),icon:(0,H.jsx)(w,{size:11})})]})]}),(0,H.jsxs)(C,{children:[(0,H.jsx)(Z,{children:`Contact`}),n?(0,H.jsxs)(H.Fragment,{children:[(0,H.jsx)(X,{label:`Name`,value:i.contactName,onChange:e=>o(`contactName`,e)}),(0,H.jsx)(X,{label:`Address`,value:i.contactAddress,onChange:e=>o(`contactAddress`,e),icon:(0,H.jsx)(e,{size:11})}),(0,H.jsxs)(`div`,{style:{display:`grid`,gridTemplateColumns:`2fr 1fr 1fr`,gap:10},children:[(0,H.jsx)(X,{label:`City`,value:i.contactCity,onChange:e=>o(`contactCity`,e)}),(0,H.jsx)(X,{label:`State`,value:i.contactState,onChange:e=>o(`contactState`,e)}),(0,H.jsx)(X,{label:`Zip`,value:i.contactZip,onChange:e=>o(`contactZip`,e)})]}),(0,H.jsx)(X,{label:`Phone`,value:i.contactPhone,onChange:e=>o(`contactPhone`,e),type:`tel`,icon:(0,H.jsx)(O,{size:11})}),(0,H.jsx)(X,{label:`Email`,value:i.contactEmail,onChange:e=>o(`contactEmail`,e),type:`email`,icon:(0,H.jsx)(A,{size:11})})]}):(0,H.jsxs)(H.Fragment,{children:[(0,H.jsx)(Y,{label:`Name`,value:t.contactName}),(0,H.jsx)(Y,{label:`Address`,value:ee||null,icon:(0,H.jsx)(e,{size:11})}),(0,H.jsx)(Y,{label:`Phone`,value:t.contactPhone,icon:(0,H.jsx)(O,{size:11})}),(0,H.jsx)(Y,{label:`Email`,value:t.contactEmail,icon:(0,H.jsx)(A,{size:11})})]})]}),(0,H.jsxs)(C,{children:[(0,H.jsx)(Z,{children:`Order Details`}),n?(0,H.jsxs)(H.Fragment,{children:[(0,H.jsx)(X,{label:`PO Number`,value:i.poNumber,onChange:e=>o(`poNumber`,e),icon:(0,H.jsx)(S,{size:11})}),(0,H.jsx)(X,{label:`Sidemark`,value:i.sidemark,onChange:e=>o(`sidemark`,e),icon:(0,H.jsx)(c,{size:11})}),(0,H.jsx)(X,{label:`Client Reference`,value:i.clientReference,onChange:e=>o(`clientReference`,e)}),(0,H.jsx)(X,{label:`Details / Notes`,value:i.details,onChange:e=>o(`details`,e),type:`textarea`,rows:3})]}):(0,H.jsxs)(H.Fragment,{children:[(0,H.jsx)(Y,{label:`Order Type`,value:t.orderType?t.orderType.replace(/_/g,` `):null,icon:(0,H.jsx)(r,{size:11})}),(0,H.jsx)(Y,{label:`PO Number`,value:t.poNumber,icon:(0,H.jsx)(S,{size:11})}),(0,H.jsx)(Y,{label:`Sidemark`,value:t.sidemark,icon:(0,H.jsx)(c,{size:11})}),(0,H.jsx)(Y,{label:`Client Reference`,value:t.clientReference}),(0,H.jsx)(Y,{label:`Source`,value:t.source}),t.dtDispatchId!=null&&(0,H.jsx)(Y,{label:`Dispatch ID`,value:String(t.dtDispatchId)}),t.details&&(0,H.jsx)(Y,{label:`Details / Notes`,value:t.details})]})]}),(h||n)&&(0,H.jsxs)(C,{children:[(0,H.jsx)(Z,{children:`Pricing`}),n?(0,H.jsxs)(H.Fragment,{children:[(0,H.jsx)(X,{label:`Base Fee`,value:i.baseDeliveryFee,onChange:e=>o(`baseDeliveryFee`,e),type:`number`}),(0,H.jsx)(X,{label:`Order Total`,value:i.orderTotal,onChange:e=>o(`orderTotal`,e),type:`number`,icon:(0,H.jsx)(b,{size:11})}),(0,H.jsx)(`div`,{style:{fontSize:11,color:l.colors.textMuted,marginTop:-4,fontStyle:`italic`},children:`Changing either pricing field marks the order as manually overridden.`})]}):(0,H.jsxs)(H.Fragment,{children:[t.baseDeliveryFee!=null&&(0,H.jsxs)(`div`,{style:{display:`flex`,justifyContent:`space-between`,fontSize:13,marginBottom:8},children:[(0,H.jsx)(`span`,{style:{color:y.textSecondary},children:t.isPickup?`Base Pickup Fee`:`Base Delivery Fee`}),(0,H.jsx)(`span`,{style:{fontWeight:600},children:G(t.baseDeliveryFee)})]}),t.extraItemsCount>0&&(0,H.jsxs)(`div`,{style:{display:`flex`,justifyContent:`space-between`,fontSize:13,marginBottom:8},children:[(0,H.jsxs)(`span`,{style:{color:y.textSecondary},children:[`Extra Items (`,t.extraItemsCount,` × $25)`]}),(0,H.jsx)(`span`,{style:{fontWeight:600},children:G(t.extraItemsFee)})]}),t.accessorials?.map((e,t)=>(0,H.jsxs)(`div`,{style:{display:`flex`,justifyContent:`space-between`,fontSize:13,marginBottom:8},children:[(0,H.jsxs)(`span`,{style:{color:y.textSecondary},children:[e.code,e.quantity>1?` × ${e.quantity}`:``]}),(0,H.jsx)(`span`,{style:{fontWeight:600},children:G(e.subtotal)})]},t)),t.fabricProtectionTotal>0&&(0,H.jsxs)(`div`,{style:{display:`flex`,justifyContent:`space-between`,fontSize:13,marginBottom:8},children:[(0,H.jsx)(`span`,{style:{color:y.textSecondary},children:`Fabric Protection`}),(0,H.jsx)(`span`,{style:{fontWeight:600},children:G(t.fabricProtectionTotal)})]}),t.orderTotal!=null&&(0,H.jsxs)(`div`,{style:{display:`flex`,justifyContent:`space-between`,fontSize:14,marginTop:12,paddingTop:12,borderTop:`1px solid ${l.colors.border}`,fontWeight:700,color:y.textPrimary},children:[(0,H.jsxs)(`span`,{style:{display:`inline-flex`,alignItems:`center`,gap:4},children:[(0,H.jsx)(b,{size:13}),`Order Total`,t.pricingOverride&&(0,H.jsx)(`span`,{style:{fontSize:10,fontWeight:600,background:`#FEF3C7`,color:`#B45309`,padding:`1px 6px`,borderRadius:6,marginLeft:6},children:`MANUAL`})]}),(0,H.jsx)(`span`,{children:G(t.orderTotal)})]}),t.pricingNotes&&(0,H.jsx)(`div`,{style:{fontSize:11,color:y.textMuted,marginTop:8,fontStyle:`italic`},children:t.pricingNotes}),(0,H.jsx)(`div`,{style:{fontSize:11,color:y.textMuted,marginTop:10,fontStyle:`italic`,lineHeight:1.45},children:`Pricing is estimated based on the information provided. If additional assembly, labor, or special handling services are required at the time of delivery, rates may be adjusted accordingly.`})]})]}),(0,H.jsxs)(C,{children:[(0,H.jsx)(Z,{children:`Review`}),n?(0,H.jsxs)(H.Fragment,{children:[(0,H.jsx)(X,{label:`Review Status`,value:i.reviewStatus,onChange:e=>o(`reviewStatus`,e),type:`select`,options:ye}),(0,H.jsx)(X,{label:`Review Notes`,value:i.reviewNotes,onChange:e=>o(`reviewNotes`,e),type:`textarea`,rows:3})]}):(0,H.jsxs)(H.Fragment,{children:[t.reviewStatus&&t.reviewStatus!==`not_required`&&U[t.reviewStatus]&&(0,H.jsxs)(`div`,{style:{display:`inline-flex`,alignItems:`center`,gap:6,padding:`4px 12px`,borderRadius:12,fontSize:12,fontWeight:600,background:U[t.reviewStatus].bg,color:U[t.reviewStatus].color,marginBottom:12},children:[U[t.reviewStatus].icon,U[t.reviewStatus].label]}),t.createdByRole&&(0,H.jsx)(Y,{label:`Created By`,value:t.createdByRole}),t.reviewNotes&&(0,H.jsx)(Y,{label:`Review Notes`,value:t.reviewNotes}),t.reviewedAt&&(0,H.jsx)(Y,{label:`Reviewed At`,value:new Date(t.reviewedAt).toLocaleString()}),t.pushedToDtAt&&(0,H.jsx)(Y,{label:`Pushed to DT`,value:new Date(t.pushedToDtAt).toLocaleString()}),t.lastSyncedAt&&(0,H.jsx)(Y,{label:`Last Synced`,value:new Date(t.lastSyncedAt).toLocaleString()})]})]}),n&&(0,H.jsx)(C,{style:{background:`#FAFAF9`},children:(0,H.jsxs)(`div`,{style:{display:`flex`,alignItems:`center`,justifyContent:`space-between`,gap:12},children:[(0,H.jsx)(`div`,{style:{fontSize:12,color:u?`#DC2626`:y.textMuted,flex:1,minWidth:0,overflow:`hidden`,textOverflow:`ellipsis`,whiteSpace:`nowrap`},children:u??`Editing — save to persist changes.`}),(0,H.jsxs)(`div`,{style:{display:`flex`,gap:8,flexShrink:0},children:[(0,H.jsxs)(`button`,{onClick:f,disabled:s,style:{background:`#fff`,color:y.textPrimary,border:`1px solid ${l.colors.border}`,cursor:s?`not-allowed`:`pointer`,padding:`8px 16px`,borderRadius:8,fontSize:13,fontWeight:500,opacity:s?.6:1,fontFamily:`inherit`,display:`inline-flex`,alignItems:`center`,gap:5},children:[(0,H.jsx)(oe,{size:13}),` Cancel`]}),(0,H.jsxs)(`button`,{onClick:m,disabled:s,style:{background:y.accent,color:`#fff`,border:`none`,cursor:s?`progress`:`pointer`,padding:`8px 16px`,borderRadius:8,fontSize:13,fontWeight:600,opacity:s?.85:1,fontFamily:`inherit`,display:`inline-flex`,alignItems:`center`,gap:6},children:[s&&(0,H.jsx)(a,{size:12,color:`#fff`}),s?`Saving…`:`Save Changes`]})]})]})})]})}function Ce({items:e}){return e.length===0?(0,H.jsx)(C,{children:(0,H.jsx)(`div`,{style:{textAlign:`center`,color:y.textMuted,fontSize:13,padding:`24px 0`},children:`No items on this order.`})}):(0,H.jsxs)(C,{children:[(0,H.jsx)(`div`,{style:{display:`flex`,flexDirection:`column`,gap:10},children:e.map((e,t)=>{let n=e.quantity??0,r=e.deliveredQuantity??null,i=e.delivered===!1,a=r!=null&&n>0&&r<n,o=e.delivered===!0||r!=null&&n>0&&r>=n;return(0,H.jsxs)(`div`,{style:{padding:`12px 14px`,borderRadius:10,background:t%2==0?`#FAFAF9`:`#fff`,border:`1px solid ${l.colors.border}`},children:[(0,H.jsxs)(`div`,{style:{display:`flex`,alignItems:`flex-start`,justifyContent:`space-between`,gap:12,marginBottom:6},children:[(0,H.jsx)(`div`,{style:{fontSize:13,fontWeight:600,color:y.textPrimary,flex:1,minWidth:0},children:e.description||`No description`}),o&&(0,H.jsxs)(`span`,{style:{display:`inline-flex`,alignItems:`center`,gap:4,fontSize:11,fontWeight:600,background:`#F0FDF4`,color:`#15803D`,padding:`2px 8px`,borderRadius:10,flexShrink:0},children:[(0,H.jsx)(g,{size:11}),` Delivered`]}),(i||a)&&!o&&(0,H.jsxs)(`span`,{style:{display:`inline-flex`,alignItems:`center`,gap:4,fontSize:11,fontWeight:600,background:`#FEF3C7`,color:`#B45309`,padding:`2px 8px`,borderRadius:10,flexShrink:0},children:[(0,H.jsx)(x,{size:11}),` Short`]})]}),(0,H.jsxs)(`div`,{style:{display:`flex`,gap:16,flexWrap:`wrap`,fontSize:12,color:y.textSecondary},children:[e.dtItemCode&&(0,H.jsxs)(`span`,{children:[(0,H.jsx)(`span`,{style:{fontWeight:600},children:`SKU:`}),` `,e.dtItemCode]}),e.quantity!=null&&(0,H.jsxs)(`span`,{children:[(0,H.jsx)(`span`,{style:{fontWeight:600},children:`Qty:`}),` `,e.quantity]}),e.deliveredQuantity!=null&&(0,H.jsxs)(`span`,{children:[(0,H.jsx)(`span`,{style:{fontWeight:600},children:`Delivered:`}),` `,(0,H.jsx)(`span`,{style:{color:a?`#B45309`:`#15803D`},children:e.deliveredQuantity})]}),e.checkedQuantity!=null&&e.checkedQuantity!==e.deliveredQuantity&&(0,H.jsxs)(`span`,{children:[(0,H.jsx)(`span`,{style:{fontWeight:600},children:`Checked:`}),` `,e.checkedQuantity]}),e.dtLocation&&(0,H.jsxs)(`span`,{children:[(0,H.jsx)(`span`,{style:{fontWeight:600},children:`Location:`}),` `,e.dtLocation]}),e.unitPrice!=null&&e.unitPrice>0&&(0,H.jsxs)(`span`,{children:[(0,H.jsx)(`span`,{style:{fontWeight:600},children:`Amount:`}),` $`,e.unitPrice.toFixed(2)]})]}),e.itemNote&&(0,H.jsxs)(`div`,{style:{fontSize:12,color:`#92400E`,marginTop:6,padding:`6px 8px`,background:`#FFFBEB`,borderRadius:6,borderLeft:`3px solid #F59E0B`},children:[(0,H.jsx)(`span`,{style:{fontWeight:600},children:`Driver note:`}),` `,e.itemNote]}),e.returnCodes&&e.returnCodes.length>0&&(0,H.jsxs)(`div`,{style:{fontSize:11,color:`#991B1B`,marginTop:6,fontWeight:500},children:[`Return codes: `,e.returnCodes.join(`, `)]}),e.notes&&(0,H.jsx)(`div`,{style:{fontSize:11,color:y.textMuted,marginTop:6,fontStyle:`italic`},children:e.notes})]},e.id||t)})}),(0,H.jsx)(`div`,{style:{fontSize:11,color:y.textMuted,marginTop:12,fontStyle:`italic`},children:`Items can't be edited here — cancel and recreate the order to change items.`})]})}function Q(e){if(!e)return`—`;try{return new Date(e).toLocaleString(`en-US`,{month:`short`,day:`numeric`,hour:`numeric`,minute:`2-digit`})}catch{return e}}function $(e){if(e==null)return`—`;if(e<60)return`${e} min`;let t=Math.floor(e/60),n=e%60;return n===0?`${t}h`:`${t}h ${n}m`}function we({order:e,notes:t,history:n,photos:i,loading:a}){if(!(e.startedAt||e.finishedAt||e.driverName||e.truckName||e.signatureCapturedAt||e.codAmount!=null||e.dtStatusCode)&&n.length===0&&t.length===0&&i.length===0)return(0,H.jsx)(C,{children:(0,H.jsx)(`div`,{style:{textAlign:`center`,color:y.textMuted,fontSize:13,padding:`24px 0`},children:a?`Loading completion data…`:e.pushedToDtAt?`No driver activity yet. Click "DT Sync" on the Orders page to pull the latest from DispatchTrack.`:`This order hasn't been pushed to DispatchTrack yet.`})});let o=e.actualServiceTimeMinutes;return(0,H.jsxs)(`div`,{style:{display:`flex`,flexDirection:`column`,gap:16},children:[(e.driverName||e.truckName||e.serviceUnit||e.stopNumber!=null)&&(0,H.jsxs)(C,{children:[(0,H.jsx)(Z,{children:`Driver & Vehicle`}),(0,H.jsx)(Y,{label:`Driver`,value:e.driverName||null,icon:(0,H.jsx)(d,{size:11})}),(0,H.jsx)(Y,{label:`Truck`,value:e.truckName?`${e.truckName}${e.truckId?` (#${e.truckId})`:``}`:null,icon:(0,H.jsx)(r,{size:11})}),(0,H.jsx)(Y,{label:`Service Unit`,value:e.serviceUnit||null}),(0,H.jsx)(Y,{label:`Stop #`,value:e.stopNumber==null?null:String(e.stopNumber)})]}),(0,H.jsxs)(C,{children:[(0,H.jsx)(Z,{children:`Timing`}),(0,H.jsx)(Y,{label:`Scheduled`,value:Q(e.scheduledAt),icon:(0,H.jsx)(T,{size:11})}),(0,H.jsx)(Y,{label:`Started`,value:Q(e.startedAt),icon:(0,H.jsx)(w,{size:11})}),(0,H.jsx)(Y,{label:`Finished`,value:Q(e.finishedAt),icon:(0,H.jsx)(g,{size:11})}),o!=null&&(0,H.jsx)(Y,{label:`Actual Service Time`,value:$(o),icon:(0,H.jsx)(j,{size:11})}),e.dtStatusCode&&(0,H.jsx)(Y,{label:`DT Status Code`,value:e.dtStatusCode})]}),(e.codAmount!=null||e.paymentCollected||e.signatureCapturedAt)&&(0,H.jsxs)(C,{children:[(0,H.jsx)(Z,{children:`Proof of Delivery`}),e.codAmount!=null&&(0,H.jsx)(Y,{label:`COD Amount`,value:G(e.codAmount),icon:(0,H.jsx)(b,{size:11})}),e.paymentCollected&&(0,H.jsx)(Y,{label:`Payment Collected`,value:`Yes`,icon:(0,H.jsx)(b,{size:11})}),e.paymentNotes&&(0,H.jsx)(Y,{label:`Payment Notes`,value:e.paymentNotes}),e.signatureCapturedAt&&(0,H.jsx)(Y,{label:`Signature Captured`,value:Q(e.signatureCapturedAt),icon:(0,H.jsx)(k,{size:11})})]}),i.length>0&&(0,H.jsxs)(C,{children:[(0,H.jsxs)(Z,{children:[`POD Photos (`,i.length,`)`]}),(0,H.jsx)(`div`,{style:{display:`grid`,gridTemplateColumns:`repeat(auto-fill, minmax(140px, 1fr))`,gap:10},children:i.map(e=>(0,H.jsxs)(`a`,{href:e.fullUrl??`#`,target:`_blank`,rel:`noopener noreferrer`,style:{display:`block`,borderRadius:8,overflow:`hidden`,border:`1px solid ${l.colors.border}`,background:`#FAFAF9`,textDecoration:`none`,color:`inherit`},title:e.capturedAt?Q(e.capturedAt):e.dtImageName,onClick:t=>{e.fullUrl||t.preventDefault()},children:[e.thumbnailUrl?(0,H.jsx)(`img`,{src:e.thumbnailUrl,alt:e.dtImageName,loading:`lazy`,style:{width:`100%`,height:120,objectFit:`cover`,display:`block`}}):(0,H.jsx)(`div`,{style:{width:`100%`,height:120,display:`flex`,alignItems:`center`,justifyContent:`center`,fontSize:11,color:y.textMuted},children:e.fetchError?`Fetch failed`:`Loading…`}),e.capturedAt&&(0,H.jsx)(`div`,{style:{fontSize:10,color:y.textMuted,padding:`4px 6px`,borderTop:`1px solid ${l.colors.border}`},children:Q(e.capturedAt)})]},e.id))})]}),t.length>0&&(0,H.jsxs)(C,{children:[(0,H.jsx)(Z,{children:(0,H.jsxs)(`span`,{style:{display:`inline-flex`,alignItems:`center`,gap:6},children:[(0,H.jsx)(de,{size:11}),` DT Notes (`,t.length,`)`]})}),(0,H.jsx)(`div`,{style:{display:`flex`,flexDirection:`column`,gap:8},children:t.map(e=>(0,H.jsxs)(`div`,{style:{padding:`8px 10px`,background:`#F8FAFC`,borderRadius:8,border:`1px solid ${l.colors.border}`},children:[(0,H.jsx)(`div`,{style:{fontSize:12,color:y.textPrimary,whiteSpace:`pre-wrap`},children:e.body}),(0,H.jsxs)(`div`,{style:{fontSize:10,color:y.textMuted,marginTop:4},children:[e.authorName||`DispatchTrack`,e.authorType&&e.authorType!==`system`?` · ${e.authorType}`:``,e.createdAtDt?` · ${Q(e.createdAtDt)}`:``]})]},e.id))})]})]})}function Te(){let{orderId:e}=o(),t=i(),{user:r}=n(),a=r?.role===`admin`||r?.role===`staff`,{order:s,status:c,error:u,refetch:d}=fe(e),[f,p]=(0,M.useState)(null);(0,M.useEffect)(()=>{s&&p(s)},[s]);let h=f??s,[g,v]=(0,M.useState)(!1),[y,b]=(0,M.useState)(()=>W(h||{})),[S,w]=(0,M.useState)(!1),[ae,T]=(0,M.useState)(null),[oe,O]=(0,M.useState)([]),[k,de]=(0,M.useState)([]),[A,j]=(0,M.useState)([]),[N,P]=(0,M.useState)(!1);(0,M.useEffect)(()=>{if(!h?.id)return;let e=!1;return P(!0),Promise.all([se(h.id),ce(h.id),le(h.id)]).then(([t,n,r])=>{e||(O(t),de(n),j(r))}).finally(()=>{e||P(!1)}),()=>{e=!0}},[h?.id,h?.lastSyncedAt]);let F=(0,M.useCallback)(async e=>{if(!h)return;let t=e===`rejected`?`Reason for rejecting (will be emailed to the submitter):`:`What revisions are needed? (will be emailed to the submitter):`,n=window.prompt(t,h.reviewNotes||``);if(n!==null){w(!0),T(null);try{let{data:t}=await E.auth.getUser(),i=t?.user?.id??null,a=`Stride Reviewer`;if(i){let{data:e}=await E.from(`profiles`).select(`display_name, email`).eq(`id`,i).maybeSingle();a=e?.display_name||e?.email||a}let{error:o}=await E.from(`dt_orders`).update({review_status:e,review_notes:n.trim()||null,reviewed_by:i,reviewed_at:new Date().toISOString()}).eq(`id`,h.id);if(o)throw o;_({orderId:h.id,tenantId:h.tenantId,action:e===`rejected`?`reject`:`revision_requested`,changes:{reviewStatus:{old:h.reviewStatus,new:e},reviewerName:a,reviewNotes:n.trim()||null},performedBy:r?.email??null});try{let{data:t,error:r}=await E.functions.invoke(`notify-order-revision`,{body:{orderId:h.id,action:e,reviewerName:a,reviewNotes:n.trim()}});r?console.warn(`[OrderPage] notify-order-revision invoke error:`,r.message):t&&t.ok===!1&&console.warn(`[OrderPage] notify-order-revision returned ok:false`,t)}catch(e){console.warn(`[OrderPage] notify-order-revision threw`,e)}let s=await D(h.id);s&&p(s),d()}catch(e){T(e instanceof Error?e.message:String(e))}finally{w(!1)}}},[h,d,r?.email]),[me,I]=(0,M.useState)(!1),[L,R]=(0,M.useState)(!1),[z,B]=(0,M.useState)(null),[he,V]=(0,M.useState)(!1);(0,M.useEffect)(()=>{h&&!g&&b(W(h))},[h,g]);let ge=(0,M.useCallback)((e,t)=>{b(n=>({...n,[e]:t}))},[]),_e=(0,M.useCallback)(()=>{h&&b(W(h)),T(null),v(!0)},[h]),ye=(0,M.useCallback)(()=>{v(!1),T(null)},[]),G=(0,M.useCallback)(async()=>{if(h){w(!0),T(null);try{let{data:e}=await E.auth.getUser(),t=e?.user?.id??null,n={contact_name:y.contactName.trim()||null,contact_address:y.contactAddress.trim()||null,contact_city:y.contactCity.trim()||null,contact_state:y.contactState.trim()||null,contact_zip:y.contactZip.trim()||null,contact_phone:y.contactPhone.trim()||null,contact_email:y.contactEmail.trim()||null,local_service_date:y.localServiceDate||null,window_start_local:y.windowStartLocal||null,window_end_local:y.windowEndLocal||null,po_number:y.poNumber.trim()||null,sidemark:y.sidemark.trim()||null,client_reference:y.clientReference.trim()||null,details:y.details.trim()||null,review_status:y.reviewStatus,review_notes:y.reviewNotes.trim()||null,reviewed_by:t,reviewed_at:new Date().toISOString()},i=y.orderTotal===``?null:Number(y.orderTotal),a=y.baseDeliveryFee===``?null:Number(y.baseDeliveryFee),o=i!==h.orderTotal||a!==h.baseDeliveryFee;o&&(n.order_total=i,n.base_delivery_fee=a,n.pricing_override=!0);let{error:s}=await E.from(`dt_orders`).update(n).eq(`id`,h.id);if(s)throw s;let c=[];if(y.contactName!==(h.contactName??``)&&c.push(`contactName`),y.contactAddress!==(h.contactAddress??``)&&c.push(`contactAddress`),y.contactCity!==(h.contactCity??``)&&c.push(`contactCity`),y.contactState!==(h.contactState??``)&&c.push(`contactState`),y.contactZip!==(h.contactZip??``)&&c.push(`contactZip`),y.contactPhone!==(h.contactPhone??``)&&c.push(`contactPhone`),y.contactEmail!==(h.contactEmail??``)&&c.push(`contactEmail`),y.localServiceDate!==(h.localServiceDate??``)&&c.push(`localServiceDate`),y.windowStartLocal!==(h.windowStartLocal??``).slice(0,5)&&c.push(`windowStartLocal`),y.windowEndLocal!==(h.windowEndLocal??``).slice(0,5)&&c.push(`windowEndLocal`),y.poNumber!==(h.poNumber??``)&&c.push(`poNumber`),y.sidemark!==(h.sidemark??``)&&c.push(`sidemark`),y.clientReference!==(h.clientReference??``)&&c.push(`clientReference`),y.details!==(h.details??``)&&c.push(`details`),y.reviewStatus!==h.reviewStatus&&c.push(`reviewStatus`),y.reviewNotes!==(h.reviewNotes??``)&&c.push(`reviewNotes`),o&&c.push(`pricing`),_({orderId:h.id,tenantId:h.tenantId,action:`update`,changes:{fieldsChanged:c,...y.reviewStatus===h.reviewStatus?{}:{reviewStatus:{old:h.reviewStatus,new:y.reviewStatus}},...o?{orderTotal:{old:h.orderTotal,new:i},baseDeliveryFee:{old:h.baseDeliveryFee,new:a}}:{}},performedBy:r?.email??null}),(y.reviewStatus===`revision_requested`||y.reviewStatus===`rejected`)&&y.reviewStatus!==h.reviewStatus){let e=`Stride Reviewer`;if(t){let{data:n}=await E.from(`profiles`).select(`display_name, email`).eq(`id`,t).maybeSingle();e=n?.display_name||n?.email||e}try{let{data:t,error:n}=await E.functions.invoke(`notify-order-revision`,{body:{orderId:h.id,action:y.reviewStatus,reviewerName:e,reviewNotes:y.reviewNotes.trim()}});n?console.warn(`[OrderPage] notify-order-revision invoke error:`,n.message):t&&t.ok===!1&&console.warn(`[OrderPage] notify-order-revision returned ok:false`,t)}catch(e){console.warn(`[OrderPage] notify-order-revision threw`,e)}}v(!1);let l=await D(h.id);l&&p(l),d()}catch(e){T(e instanceof Error?e.message:String(e))}finally{w(!1)}}},[h,y,d,r?.email]);if(c===`loading`)return(0,H.jsxs)(`div`,{style:{display:`flex`,flexDirection:`column`,alignItems:`center`,justifyContent:`center`,height:`100%`,gap:16,color:l.colors.textMuted},children:[(0,H.jsx)(ee,{size:32,style:{animation:`spin 1s linear infinite`}}),(0,H.jsx)(`div`,{style:{fontSize:14},children:`Loading order…`}),(0,H.jsx)(`style`,{children:`@keyframes spin { to { transform: rotate(360deg) } }`})]});if(c===`not-found`)return(0,H.jsx)(xe,{icon:ue,color:l.colors.textMuted,title:`Order Not Found`,body:`No order found with this ID.`,actions:(0,H.jsx)(`button`,{onClick:()=>t(`/orders`),style:be,children:`Back to Orders`})});if(c===`error`)return(0,H.jsx)(xe,{icon:x,color:l.colors.statusRed,title:`Failed to Load Order`,body:u||`An unexpected error occurred.`,actions:(0,H.jsxs)(`div`,{style:{display:`flex`,gap:12},children:[(0,H.jsx)(`button`,{onClick:d,style:{...be,color:l.colors.primary},children:`Retry`}),(0,H.jsx)(`button`,{onClick:()=>t(`/orders`),style:be,children:`Back to Orders`})]})});if(!h)return null;let K=ve[h.statusCategory]||ve.open,q=h.reviewStatus&&h.reviewStatus!==`not_required`?U[h.reviewStatus]:null,J=(0,H.jsxs)(`span`,{style:{display:`inline-flex`,alignItems:`center`,gap:6,flexWrap:`wrap`},children:[h.isPickup&&(0,H.jsx)(`span`,{style:{fontSize:10,fontWeight:700,background:`#FEF3C7`,color:`#B45309`,padding:`2px 8px`,borderRadius:10,letterSpacing:`1px`,textTransform:`uppercase`},children:`PICKUP`}),(0,H.jsx)(`span`,{style:{fontSize:12,fontWeight:600,background:K.bg,color:K.color,padding:`3px 10px`,borderRadius:12},children:h.statusName||K.label}),q&&(0,H.jsxs)(`span`,{style:{fontSize:12,fontWeight:600,background:q.bg,color:q.color,padding:`3px 10px`,borderRadius:12,display:`inline-flex`,alignItems:`center`,gap:4},children:[q.icon,q.label]})]}),Y=[{id:`details`,label:`Details`,keepMounted:!0,render:()=>(0,H.jsx)(Se,{order:h,editing:g,edit:y,setField:ge,saving:S,saveError:ae,onStartEdit:_e,onCancelEdit:ye,onSave:G})},{id:`items`,label:`Items`,badgeCount:h.items?.length??0,render:()=>(0,H.jsx)(Ce,{items:h.items??[]})},{id:`completion`,label:`Completion`,badgeCount:k.length>0?k.length:void 0,render:()=>(0,H.jsx)(we,{order:h,notes:k,history:oe,photos:A,loading:N})},{id:`activity`,label:`Activity`,render:()=>(0,H.jsx)(C,{children:(0,H.jsx)(te,{entityType:`dt_order`,entityId:h.id,tenantId:h.tenantId??void 0})})}],X=(()=>{let e=new Set,t=[];for(let n of h.items??[]){let r=n.inventoryId||n.dtItemCode;!r||e.has(r)||(e.add(r),t.push(n))}return t})(),Z=h.statusCategory===`completed`&&!!h.tenantId&&X.length>0,Q=g?null:(0,H.jsx)(m,{label:`Print PDF`,variant:`secondary`,onClick:()=>pe(h)},`print-pdf`),$=a&&!g?(0,H.jsxs)(H.Fragment,{children:[Q,(0,H.jsx)(m,{label:`Edit Full Order`,variant:`secondary`,onClick:()=>I(!0)}),Z&&(0,H.jsx)(m,{label:`Release Items`,variant:`primary`,onClick:()=>V(!0)}),(h.reviewStatus===`pending_review`||h.reviewStatus===`revision_requested`)&&(0,H.jsxs)(H.Fragment,{children:[(0,H.jsx)(m,{label:`Approve`,variant:`primary`,onClick:async()=>{await E.from(`dt_orders`).update({review_status:`approved`,reviewed_at:new Date().toISOString()}).eq(`id`,h.id),_({orderId:h.id,tenantId:h.tenantId,action:`approve`,changes:{reviewStatus:{old:h.reviewStatus,new:`approved`}},performedBy:r?.email??null});let e=await D(h.id);e&&p(e),d()}}),(0,H.jsx)(m,{label:`Request Revision`,variant:`secondary`,onClick:()=>F(`revision_requested`)}),(0,H.jsx)(m,{label:`Reject`,variant:`secondary`,onClick:()=>F(`rejected`)})]}),h.reviewStatus===`approved`&&!h.pushedToDtAt&&(0,H.jsx)(m,{label:L?`Pushing…`:`Push to DT`,variant:`primary`,onClick:async()=>{if(!L){R(!0),B(null);try{let{data:e,error:t}=await E.functions.invoke(`dt-push-order`,{body:{orderId:h.id}});if(t){let e=t.message;try{let n=t.context;if(n?.json){let t=await n.json();t?.error&&(e=t.error,t.responseBody&&(e+=` (DT response: ${t.responseBody.slice(0,200)})`))}}catch{}throw Error(e)}let n=e;if(!n?.ok)throw Error(n?.error||`DT push failed`);_({orderId:h.id,tenantId:h.tenantId,action:`push_to_dt`,changes:{dtIdentifier:n.dt_identifier??h.dtIdentifier,...n.linked_identifier?{linkedIdentifier:n.linked_identifier}:{},orderType:h.orderType,itemCount:h.items?.length??0},performedBy:r?.email??null}),n.linked_identifier&&h.linkedOrderId&&_({orderId:h.linkedOrderId,tenantId:h.tenantId,action:`push_to_dt`,changes:{dtIdentifier:n.linked_identifier,linkedIdentifier:n.dt_identifier??h.dtIdentifier,pushedAlongsideDelivery:!0},performedBy:r?.email??null});let i=await D(h.id);i&&p(i),d()}catch(e){let t=e instanceof Error?e.message:String(e);console.error(`[OrderPage] DT push failed:`,t,e),B(t)}finally{R(!1)}}}})]}):Q,Te=$!==null&&M.Children.count($)>0;return(0,H.jsxs)(H.Fragment,{children:[z&&(0,H.jsxs)(`div`,{role:`alert`,style:{position:`fixed`,top:16,left:`50%`,transform:`translateX(-50%)`,zIndex:1100,padding:`14px 18px`,background:`#FEF2F2`,border:`1px solid #FCA5A5`,color:`#991B1B`,borderRadius:10,fontSize:13,maxWidth:720,boxShadow:`0 8px 24px rgba(0,0,0,0.15)`,display:`flex`,alignItems:`flex-start`,gap:10},children:[(0,H.jsxs)(`div`,{style:{flex:1,minWidth:0},children:[(0,H.jsx)(`div`,{style:{fontWeight:700,marginBottom:4},children:`DT push failed`}),(0,H.jsx)(`div`,{style:{fontWeight:400,whiteSpace:`pre-wrap`,wordBreak:`break-word`},children:z})]}),(0,H.jsx)(`button`,{onClick:()=>B(null),style:{background:`none`,border:`none`,cursor:`pointer`,color:`#991B1B`,fontWeight:700,fontSize:18,lineHeight:1,padding:0,flexShrink:0},"aria-label":`Dismiss`,children:`×`})]}),(0,H.jsx)(re,{entityLabel:`ORDER`,entityId:h.dtIdentifier||h.id.slice(0,8).toUpperCase(),statusBadge:J,clientName:h.clientName||void 0,tabs:Y,initialTabId:`details`,footer:Te?$:void 0}),me&&(0,H.jsx)(ne,{editOrderId:h.id,onClose:()=>I(!1),onSubmit:async()=>{I(!1);let e=await D(h.id);e&&p(e),d()}}),he&&h.tenantId&&(0,H.jsx)(ie,{itemIds:X.map(e=>e.dtItemCode||e.inventoryId),clientName:h.clientName||`this client`,clientSheetId:h.tenantId,defaultReleaseDate:h.finishedAt?h.finishedAt.slice(0,10):void 0,selectableItems:X.map(e=>({id:e.dtItemCode||e.inventoryId,label:e.description||e.dtItemCode||`Item`,sublabel:[e.dtItemCode&&`SKU ${e.dtItemCode}`,e.quantity!=null&&`Qty ${e.quantity}`].filter(Boolean).join(` · `)||void 0})),onClose:()=>V(!1),onSuccess:async()=>{let e=await D(h.id);e&&p(e),d()}})]})}export{Te as OrderPage};