import{$ as e,Dt as t,Et as n,H as r,It as i,L as a,Lt as o,Q as s,R as c,Ut as l,V as u,Vt as d,Z as f,d as p,et as ee,f as m,ft as h,i as g,k as _,l as v,m as te,n as ne,ot as y,p as re,pt as b,rt as x,t as ie,u as S,ut as C,wt as w,yt as T,z as E}from"./ReleaseItemsModal-C-fSgiiY.js";import{K as D,d as ae,f as oe,p as se,u as O}from"./supabaseQueries-DHzS-vLh.js";import{t as k}from"./phone-DFWdNFtI.js";import{t as ce}from"./search-x-B6DcZkDn.js";import{D as le,E as A,O as ue}from"./index-jWc4mVTB.js";var de=w(`clock-3`,[[`circle`,{cx:`12`,cy:`12`,r:`10`,key:`1mglay`}],[`path`,{d:`M12 6v6h4`,key:`135r8i`}]]),j=l(d(),1);function fe(e){let{clients:t}=_(),[n,r]=(0,j.useState)(null),[i,a]=(0,j.useState)(`loading`),[o,s]=(0,j.useState)(null),c=(0,j.useRef)(null),l=(0,j.useRef)(0),u=(0,j.useMemo)(()=>{let e={};for(let n of t)e[n.id]=n.name;return e},[t]),d=(0,j.useRef)(u);d.current=u;let f=(0,j.useCallback)(async()=>{if(!e)return;c.current?.abort();let t=new AbortController;c.current=t;let n=++l.current;a(`loading`),s(null);try{let i=await O(e,d.current);if(t.signal.aborted||n!==l.current)return;if(!i){a(`not-found`);return}r(i),a(`loaded`)}catch(e){if(t.signal.aborted||n!==l.current)return;s(e instanceof Error?e.message:`Failed to load order`),a(`error`)}},[e]);return(0,j.useEffect)(()=>(f(),()=>{c.current?.abort()}),[f]),{order:n,status:i,error:o,refetch:f}}function pe(e){let t=he(e),n=window.open(``,`_blank`);if(!n){alert(`Please allow pop-ups for this site, then try again.`);return}n.document.open(),n.document.write(t),n.document.close(),setTimeout(()=>{try{n.print()}catch{}},450)}function M(e){return e==null?`—`:`$`+e.toLocaleString(`en-US`,{minimumFractionDigits:2,maximumFractionDigits:2})}function N(e){if(!e)return`—`;try{return new Date(e+`T00:00:00`).toLocaleDateString(`en-US`,{weekday:`short`,month:`short`,day:`numeric`,year:`numeric`})}catch{return e}}function P(e){if(!e)return`—`;try{return new Date(e).toLocaleString(`en-US`)}catch{return e}}function F(e,t,n){if(!e&&!t)return`—`;let r=e=>{let[t,n]=e.split(`:`),r=parseInt(t);if(Number.isNaN(r))return e;let i=r>=12?`PM`:`AM`;return r===0?r=12:r>12&&(r-=12),`${r}:${n} ${i}`};return[e&&r(e),t&&r(t)].filter(Boolean).join(` – `)+(n===`America/Los_Angeles`?` PT`:n?` (${n})`:``)}function I(e){return e==null?``:String(e).replace(/&/g,`&amp;`).replace(/</g,`&lt;`).replace(/>/g,`&gt;`).replace(/"/g,`&quot;`).replace(/'/g,`&#39;`)}function L(e,t){return!t||t===`—`?``:`<tr><th>${I(e)}</th><td>${I(t)}</td></tr>`}function R(e){let t=F(e.windowStartLocal,e.windowEndLocal,e.timezone),n=[L(`Service Date`,N(e.localServiceDate)),L(`Time Window`,t),L(`Order Type`,e.orderType?e.orderType.replace(/_/g,` `):null),L(`Scheduled`,P(e.scheduledAt)),L(`Started`,P(e.startedAt)),L(`Finished`,P(e.finishedAt))].filter(Boolean).join(``);return n?`<section><h2>Schedule</h2><table class="kv">${n}</table></section>`:``}function z(e){let t=[e.contactAddress,e.contactCity,e.contactState,e.contactZip].filter(Boolean).join(`, `),n=[L(`Name`,e.contactName),L(`Address`,t),L(`Phone`,e.contactPhone),L(`Email`,e.contactEmail)].filter(Boolean).join(``);return n?`<section><h2>${e.isPickup?`Pickup Contact`:`Delivery Contact`}</h2><table class="kv">${n}</table></section>`:``}function B(e){let t=[L(`PO Number`,e.poNumber),L(`Sidemark`,e.sidemark),L(`Client Reference`,e.clientReference),L(`Source`,e.source),e.dtDispatchId==null?``:L(`Dispatch ID`,String(e.dtDispatchId))].filter(Boolean).join(``),n=e.details?`<div class="notes-block"><div class="notes-label">Details / Notes</div><div class="notes-body">${I(e.details)}</div></div>`:``;return!t&&!n?``:`<section><h2>Order Details</h2>${t?`<table class="kv">${t}</table>`:``}${n}</section>`}function V(e){let t=[L(`Driver`,e.driverName),e.truckName?L(`Truck`,e.truckName):``,e.serviceUnit?L(`Service Unit`,e.serviceUnit):``,e.stopNumber==null?``:L(`Stop #`,String(e.stopNumber)),e.actualServiceTimeMinutes==null?``:L(`Service Time`,`${e.actualServiceTimeMinutes} min`),e.codAmount==null?``:L(`COD Amount`,M(e.codAmount)),e.signatureCapturedAt?L(`Signature Captured`,P(e.signatureCapturedAt)):``].filter(Boolean).join(``);return t?`<section><h2>Driver &amp; Route</h2><table class="kv">${t}</table></section>`:``}function me(e){return!e.items||e.items.length===0?`<section><h2>Items</h2><div class="empty">No items on this order.</div></section>`:`<section>
    <h2>Items</h2>
    <table class="items">
      <thead>
        <tr><th class="num">#</th><th>Description</th><th class="num">Qty</th><th class="num">Delivered</th><th class="num">Amount</th></tr>
      </thead>
      <tbody>${e.items.map((e,t)=>{let n=e.quantity==null?`—`:String(e.quantity),r=e.deliveredQuantity==null?``:String(e.deliveredQuantity),i=e.unitPrice!=null&&e.unitPrice>0?M(e.unitPrice):``,a=[];e.dtItemCode&&a.push(`SKU ${I(e.dtItemCode)}`),e.vendor&&a.push(`Vendor: ${I(e.vendor)}`),e.sidemark&&a.push(`Sidemark: ${I(e.sidemark)}`),e.location&&a.push(`Location: ${I(e.location)}`),e.room&&a.push(`Room: ${I(e.room)}`);let o=a.length>0?`<div class="item-meta">${a.join(` · `)}</div>`:``,s=e.notes?`<div class="item-note">${I(e.notes)}</div>`:``,c=e.itemNote?`<div class="item-driver-note"><strong>Driver note:</strong> ${I(e.itemNote)}</div>`:``;return`
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
  </section>`}function H(e){if(!(e.baseDeliveryFee!=null||e.orderTotal!=null||(e.accessorials?.length??0)>0||e.extraItemsCount>0||e.fabricProtectionTotal>0))return``;let t=[];if(e.baseDeliveryFee!=null&&t.push(`<tr><td>${e.isPickup?`Base Pickup Fee`:`Base Delivery Fee`}</td><td class="num">${M(e.baseDeliveryFee)}</td></tr>`),e.extraItemsCount>0&&t.push(`<tr><td>Extra Items (${e.extraItemsCount} × $25)</td><td class="num">${M(e.extraItemsFee)}</td></tr>`),e.accessorials?.length)for(let n of e.accessorials){let e=n.code+(n.quantity>1?` × ${n.quantity}`:``);t.push(`<tr><td>${I(e)}</td><td class="num">${M(n.subtotal)}</td></tr>`)}e.fabricProtectionTotal>0&&t.push(`<tr><td>Fabric Protection</td><td class="num">${M(e.fabricProtectionTotal)}</td></tr>`);let n=e.orderTotal==null?``:`<tr class="total-row"><td>Order Total${e.pricingOverride?` <span class="manual-badge">MANUAL</span>`:``}</td><td class="num">${M(e.orderTotal)}</td></tr>`,r=e.pricingNotes?`<div class="pricing-notes">${I(e.pricingNotes)}</div>`:``;return`<section>
    <h2>Pricing</h2>
    <table class="totals">${t.join(``)}${n}</table>
    ${r}
  </section>`}function he(e){let t=e.dtIdentifier||e.id.slice(0,8).toUpperCase(),n=e.statusName||e.statusCode||`—`,r=new Date().toLocaleString(`en-US`),i=e.isPickup?`Pickup Order`:`Delivery Order`,a=[R(e),z(e),B(e),me(e),H(e),V(e)].filter(Boolean).join(``);return`<!DOCTYPE html>
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
        <div class="summary-value">${I(N(e.localServiceDate))}</div>
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
</html>`}var U=t(),ge={open:{bg:`#EFF6FF`,color:`#1D4ED8`,label:`Open`},in_progress:{bg:`#EDE9FE`,color:`#7C3AED`,label:`In Progress`},completed:{bg:`#F0FDF4`,color:`#15803D`,label:`Completed`},exception:{bg:`#FEF2F2`,color:`#DC2626`,label:`Exception`},cancelled:{bg:`#F3F4F6`,color:`#6B7280`,label:`Cancelled`}},W={pending_review:{bg:`#FEF3C7`,color:`#B45309`,label:`Pending Review`,icon:(0,U.jsx)(de,{size:11})},approved:{bg:`#DCFCE7`,color:`#166534`,label:`Approved`,icon:(0,U.jsx)(h,{size:11})},rejected:{bg:`#FEE2E2`,color:`#991B1B`,label:`Rejected`,icon:(0,U.jsx)(b,{size:11})},revision_requested:{bg:`#FEF3C7`,color:`#92400E`,label:`Revision Needed`,icon:(0,U.jsx)(b,{size:11})}},_e=[{value:`pending_review`,label:`Pending Review`},{value:`approved`,label:`Approved`},{value:`rejected`,label:`Rejected`},{value:`revision_requested`,label:`Revision Requested`},{value:`not_required`,label:`Not Required`}];function ve(e){return{contactName:e.contactName??``,contactAddress:e.contactAddress??``,contactCity:e.contactCity??``,contactState:e.contactState??``,contactZip:e.contactZip??``,contactPhone:e.contactPhone??``,contactEmail:e.contactEmail??``,localServiceDate:e.localServiceDate??``,windowStartLocal:(e.windowStartLocal??``).slice(0,5),windowEndLocal:(e.windowEndLocal??``).slice(0,5),poNumber:e.poNumber??``,sidemark:e.sidemark??``,clientReference:e.clientReference??``,details:e.details??``,orderTotal:e.orderTotal==null?``:String(e.orderTotal),baseDeliveryFee:e.baseDeliveryFee==null?``:String(e.baseDeliveryFee),reviewStatus:e.reviewStatus??`pending_review`,reviewNotes:e.reviewNotes??``}}function G(e){return`$${e.toFixed(2)}`}function ye(e){if(!e)return`—`;try{return new Date(e+`T00:00:00`).toLocaleDateString(`en-US`,{weekday:`short`,month:`short`,day:`numeric`,year:`numeric`})}catch{return e}}function K(e,t,n){if(!e&&!t)return`—`;let r=e=>{let[t,n]=e.split(`:`),r=parseInt(t),i=r>=12?`PM`:`AM`;return r===0?r=12:r>12&&(r-=12),`${r}:${n} ${i}`};return[e&&r(e),t&&r(t)].filter(Boolean).join(` – `)+(n===`America/Los_Angeles`?` PT`:n?` (${n})`:``)}var q={width:`100%`,padding:`7px 10px`,fontSize:13,border:`1px solid ${c.colors.border}`,borderRadius:8,outline:`none`,fontFamily:`inherit`,boxSizing:`border-box`,background:`#fff`};function J({label:e,value:t,icon:n}){return t?(0,U.jsxs)(`div`,{style:{marginBottom:14},children:[(0,U.jsx)(m,{children:n?(0,U.jsxs)(`span`,{style:{display:`inline-flex`,alignItems:`center`,gap:4},children:[n,e]}):e}),(0,U.jsx)(`div`,{style:{fontSize:13,color:v.textPrimary,lineHeight:1.5},children:t})]}):null}function Y({label:e,value:t,onChange:n,type:r=`text`,rows:i,options:a,icon:o}){return(0,U.jsxs)(`div`,{style:{marginBottom:12},children:[(0,U.jsx)(m,{children:o?(0,U.jsxs)(`span`,{style:{display:`inline-flex`,alignItems:`center`,gap:4},children:[o,e]}):e}),r===`textarea`?(0,U.jsx)(`textarea`,{value:t,onChange:e=>n(e.target.value),rows:i??3,style:{...q,resize:`vertical`}}):r===`select`?(0,U.jsx)(`select`,{value:t,onChange:e=>n(e.target.value),style:q,children:a.map(e=>(0,U.jsx)(`option`,{value:e.value,children:e.label},e.value))}):(0,U.jsx)(`input`,{type:r,value:t,onChange:e=>n(e.target.value),style:q})]})}function X({children:e}){return(0,U.jsx)(`div`,{style:{fontSize:10,fontWeight:700,color:v.textMuted,textTransform:`uppercase`,letterSpacing:`2px`,marginBottom:14,paddingBottom:8,borderBottom:`1px solid ${c.colors.border}`},children:e})}var be={display:`inline-flex`,alignItems:`center`,gap:6,padding:`${c.spacing.sm} ${c.spacing.lg}`,borderRadius:c.radii.lg,border:`1px solid ${c.colors.border}`,background:c.colors.bgCard,color:c.colors.text,fontSize:c.typography.sizes.base,fontWeight:c.typography.weights.medium,cursor:`pointer`,fontFamily:`inherit`};function xe({icon:e,color:t,title:n,body:r,actions:i}){return(0,U.jsxs)(`div`,{style:{display:`flex`,flexDirection:`column`,alignItems:`center`,justifyContent:`center`,height:`100%`,gap:16,padding:32,textAlign:`center`},children:[(0,U.jsx)(e,{size:48,color:t}),(0,U.jsx)(`div`,{style:{fontSize:18,fontWeight:600,color:c.colors.text},children:n}),(0,U.jsx)(`div`,{style:{fontSize:14,color:c.colors.textMuted,maxWidth:400},children:r}),i]})}function Se({order:t,editing:n,edit:i,setField:o,saving:l,saveError:u,onStartEdit:d,onCancelEdit:p,onSave:ee}){let m=[t.contactAddress,t.contactCity,t.contactState,t.contactZip].filter(Boolean).join(`, `),h=t.baseDeliveryFee!=null||t.orderTotal!=null||(t.accessorials?.length??0)>0;return(0,U.jsxs)(`div`,{style:{display:`flex`,flexDirection:`column`,gap:16},children:[(0,U.jsxs)(S,{children:[(0,U.jsxs)(`div`,{style:{display:`flex`,justifyContent:`space-between`,alignItems:`center`,marginBottom:14},children:[(0,U.jsx)(X,{children:`Schedule`}),!n&&(0,U.jsxs)(`button`,{onClick:d,style:{background:`none`,border:`1px solid ${c.colors.border}`,borderRadius:8,padding:`5px 12px`,cursor:`pointer`,fontFamily:`inherit`,fontSize:12,fontWeight:600,color:v.textSecondary,display:`inline-flex`,alignItems:`center`,gap:5},children:[(0,U.jsx)(f,{size:12}),` Edit`]})]}),n?(0,U.jsxs)(U.Fragment,{children:[(0,U.jsx)(Y,{label:`Service Date`,value:i.localServiceDate,onChange:e=>o(`localServiceDate`,e),type:`date`,icon:(0,U.jsx)(T,{size:11})}),(0,U.jsxs)(`div`,{style:{display:`grid`,gridTemplateColumns:`1fr 1fr`,gap:10},children:[(0,U.jsx)(Y,{label:`Window Start`,value:i.windowStartLocal,onChange:e=>o(`windowStartLocal`,e),type:`time`,icon:(0,U.jsx)(C,{size:11})}),(0,U.jsx)(Y,{label:`Window End`,value:i.windowEndLocal,onChange:e=>o(`windowEndLocal`,e),type:`time`})]})]}):(0,U.jsxs)(U.Fragment,{children:[(0,U.jsx)(J,{label:`Service Date`,value:ye(t.localServiceDate),icon:(0,U.jsx)(T,{size:11})}),(0,U.jsx)(J,{label:`Time Window`,value:K(t.windowStartLocal,t.windowEndLocal,t.timezone),icon:(0,U.jsx)(C,{size:11})})]})]}),(0,U.jsxs)(S,{children:[(0,U.jsx)(X,{children:`Contact`}),n?(0,U.jsxs)(U.Fragment,{children:[(0,U.jsx)(Y,{label:`Name`,value:i.contactName,onChange:e=>o(`contactName`,e)}),(0,U.jsx)(Y,{label:`Address`,value:i.contactAddress,onChange:e=>o(`contactAddress`,e),icon:(0,U.jsx)(e,{size:11})}),(0,U.jsxs)(`div`,{style:{display:`grid`,gridTemplateColumns:`2fr 1fr 1fr`,gap:10},children:[(0,U.jsx)(Y,{label:`City`,value:i.contactCity,onChange:e=>o(`contactCity`,e)}),(0,U.jsx)(Y,{label:`State`,value:i.contactState,onChange:e=>o(`contactState`,e)}),(0,U.jsx)(Y,{label:`Zip`,value:i.contactZip,onChange:e=>o(`contactZip`,e)})]}),(0,U.jsx)(Y,{label:`Phone`,value:i.contactPhone,onChange:e=>o(`contactPhone`,e),type:`tel`,icon:(0,U.jsx)(k,{size:11})}),(0,U.jsx)(Y,{label:`Email`,value:i.contactEmail,onChange:e=>o(`contactEmail`,e),type:`email`,icon:(0,U.jsx)(ue,{size:11})})]}):(0,U.jsxs)(U.Fragment,{children:[(0,U.jsx)(J,{label:`Name`,value:t.contactName}),(0,U.jsx)(J,{label:`Address`,value:m||null,icon:(0,U.jsx)(e,{size:11})}),(0,U.jsx)(J,{label:`Phone`,value:t.contactPhone,icon:(0,U.jsx)(k,{size:11})}),(0,U.jsx)(J,{label:`Email`,value:t.contactEmail,icon:(0,U.jsx)(ue,{size:11})})]})]}),(0,U.jsxs)(S,{children:[(0,U.jsx)(X,{children:`Order Details`}),n?(0,U.jsxs)(U.Fragment,{children:[(0,U.jsx)(Y,{label:`PO Number`,value:i.poNumber,onChange:e=>o(`poNumber`,e),icon:(0,U.jsx)(x,{size:11})}),(0,U.jsx)(Y,{label:`Sidemark`,value:i.sidemark,onChange:e=>o(`sidemark`,e),icon:(0,U.jsx)(s,{size:11})}),(0,U.jsx)(Y,{label:`Client Reference`,value:i.clientReference,onChange:e=>o(`clientReference`,e)}),(0,U.jsx)(Y,{label:`Details / Notes`,value:i.details,onChange:e=>o(`details`,e),type:`textarea`,rows:3})]}):(0,U.jsxs)(U.Fragment,{children:[(0,U.jsx)(J,{label:`Order Type`,value:t.orderType?t.orderType.replace(/_/g,` `):null,icon:(0,U.jsx)(r,{size:11})}),(0,U.jsx)(J,{label:`PO Number`,value:t.poNumber,icon:(0,U.jsx)(x,{size:11})}),(0,U.jsx)(J,{label:`Sidemark`,value:t.sidemark,icon:(0,U.jsx)(s,{size:11})}),(0,U.jsx)(J,{label:`Client Reference`,value:t.clientReference}),(0,U.jsx)(J,{label:`Source`,value:t.source}),t.dtDispatchId!=null&&(0,U.jsx)(J,{label:`Dispatch ID`,value:String(t.dtDispatchId)}),t.details&&(0,U.jsx)(J,{label:`Details / Notes`,value:t.details})]})]}),(h||n)&&(0,U.jsxs)(S,{children:[(0,U.jsx)(X,{children:`Pricing`}),n?(0,U.jsxs)(U.Fragment,{children:[(0,U.jsx)(Y,{label:`Base Fee`,value:i.baseDeliveryFee,onChange:e=>o(`baseDeliveryFee`,e),type:`number`}),(0,U.jsx)(Y,{label:`Order Total`,value:i.orderTotal,onChange:e=>o(`orderTotal`,e),type:`number`,icon:(0,U.jsx)(y,{size:11})}),(0,U.jsx)(`div`,{style:{fontSize:11,color:c.colors.textMuted,marginTop:-4,fontStyle:`italic`},children:`Changing either pricing field marks the order as manually overridden.`})]}):(0,U.jsxs)(U.Fragment,{children:[t.baseDeliveryFee!=null&&(0,U.jsxs)(`div`,{style:{display:`flex`,justifyContent:`space-between`,fontSize:13,marginBottom:8},children:[(0,U.jsx)(`span`,{style:{color:v.textSecondary},children:t.isPickup?`Base Pickup Fee`:`Base Delivery Fee`}),(0,U.jsx)(`span`,{style:{fontWeight:600},children:G(t.baseDeliveryFee)})]}),t.extraItemsCount>0&&(0,U.jsxs)(`div`,{style:{display:`flex`,justifyContent:`space-between`,fontSize:13,marginBottom:8},children:[(0,U.jsxs)(`span`,{style:{color:v.textSecondary},children:[`Extra Items (`,t.extraItemsCount,` × $25)`]}),(0,U.jsx)(`span`,{style:{fontWeight:600},children:G(t.extraItemsFee)})]}),t.accessorials?.map((e,t)=>(0,U.jsxs)(`div`,{style:{display:`flex`,justifyContent:`space-between`,fontSize:13,marginBottom:8},children:[(0,U.jsxs)(`span`,{style:{color:v.textSecondary},children:[e.code,e.quantity>1?` × ${e.quantity}`:``]}),(0,U.jsx)(`span`,{style:{fontWeight:600},children:G(e.subtotal)})]},t)),t.fabricProtectionTotal>0&&(0,U.jsxs)(`div`,{style:{display:`flex`,justifyContent:`space-between`,fontSize:13,marginBottom:8},children:[(0,U.jsx)(`span`,{style:{color:v.textSecondary},children:`Fabric Protection`}),(0,U.jsx)(`span`,{style:{fontWeight:600},children:G(t.fabricProtectionTotal)})]}),t.orderTotal!=null&&(0,U.jsxs)(`div`,{style:{display:`flex`,justifyContent:`space-between`,fontSize:14,marginTop:12,paddingTop:12,borderTop:`1px solid ${c.colors.border}`,fontWeight:700,color:v.textPrimary},children:[(0,U.jsxs)(`span`,{style:{display:`inline-flex`,alignItems:`center`,gap:4},children:[(0,U.jsx)(y,{size:13}),`Order Total`,t.pricingOverride&&(0,U.jsx)(`span`,{style:{fontSize:10,fontWeight:600,background:`#FEF3C7`,color:`#B45309`,padding:`1px 6px`,borderRadius:6,marginLeft:6},children:`MANUAL`})]}),(0,U.jsx)(`span`,{children:G(t.orderTotal)})]}),t.pricingNotes&&(0,U.jsx)(`div`,{style:{fontSize:11,color:v.textMuted,marginTop:8,fontStyle:`italic`},children:t.pricingNotes}),(0,U.jsx)(`div`,{style:{fontSize:11,color:v.textMuted,marginTop:10,fontStyle:`italic`,lineHeight:1.45},children:`Pricing is estimated based on the information provided. If additional assembly, labor, or special handling services are required at the time of delivery, rates may be adjusted accordingly.`})]})]}),(0,U.jsxs)(S,{children:[(0,U.jsx)(X,{children:`Review`}),n?(0,U.jsxs)(U.Fragment,{children:[(0,U.jsx)(Y,{label:`Review Status`,value:i.reviewStatus,onChange:e=>o(`reviewStatus`,e),type:`select`,options:_e}),(0,U.jsx)(Y,{label:`Review Notes`,value:i.reviewNotes,onChange:e=>o(`reviewNotes`,e),type:`textarea`,rows:3})]}):(0,U.jsxs)(U.Fragment,{children:[t.reviewStatus&&t.reviewStatus!==`not_required`&&W[t.reviewStatus]&&(0,U.jsxs)(`div`,{style:{display:`inline-flex`,alignItems:`center`,gap:6,padding:`4px 12px`,borderRadius:12,fontSize:12,fontWeight:600,background:W[t.reviewStatus].bg,color:W[t.reviewStatus].color,marginBottom:12},children:[W[t.reviewStatus].icon,W[t.reviewStatus].label]}),t.createdByRole&&(0,U.jsx)(J,{label:`Created By`,value:t.createdByRole}),t.reviewNotes&&(0,U.jsx)(J,{label:`Review Notes`,value:t.reviewNotes}),t.reviewedAt&&(0,U.jsx)(J,{label:`Reviewed At`,value:new Date(t.reviewedAt).toLocaleString()}),t.pushedToDtAt&&(0,U.jsx)(J,{label:`Pushed to DT`,value:new Date(t.pushedToDtAt).toLocaleString()}),t.lastSyncedAt&&(0,U.jsx)(J,{label:`Last Synced`,value:new Date(t.lastSyncedAt).toLocaleString()})]})]}),n&&(0,U.jsx)(S,{style:{background:`#FAFAF9`},children:(0,U.jsxs)(`div`,{style:{display:`flex`,alignItems:`center`,justifyContent:`space-between`,gap:12},children:[(0,U.jsx)(`div`,{style:{fontSize:12,color:u?`#DC2626`:v.textMuted,flex:1,minWidth:0,overflow:`hidden`,textOverflow:`ellipsis`,whiteSpace:`nowrap`},children:u??`Editing — save to persist changes.`}),(0,U.jsxs)(`div`,{style:{display:`flex`,gap:8,flexShrink:0},children:[(0,U.jsxs)(`button`,{onClick:p,disabled:l,style:{background:`#fff`,color:v.textPrimary,border:`1px solid ${c.colors.border}`,cursor:l?`not-allowed`:`pointer`,padding:`8px 16px`,borderRadius:8,fontSize:13,fontWeight:500,opacity:l?.6:1,fontFamily:`inherit`,display:`inline-flex`,alignItems:`center`,gap:5},children:[(0,U.jsx)(E,{size:13}),` Cancel`]}),(0,U.jsxs)(`button`,{onClick:ee,disabled:l,style:{background:v.accent,color:`#fff`,border:`none`,cursor:l?`progress`:`pointer`,padding:`8px 16px`,borderRadius:8,fontSize:13,fontWeight:600,opacity:l?.85:1,fontFamily:`inherit`,display:`inline-flex`,alignItems:`center`,gap:6},children:[l&&(0,U.jsx)(a,{size:12,color:`#fff`}),l?`Saving…`:`Save Changes`]})]})]})})]})}function Ce({items:e}){return e.length===0?(0,U.jsx)(S,{children:(0,U.jsx)(`div`,{style:{textAlign:`center`,color:v.textMuted,fontSize:13,padding:`24px 0`},children:`No items on this order.`})}):(0,U.jsxs)(S,{children:[(0,U.jsx)(`div`,{style:{display:`flex`,flexDirection:`column`,gap:10},children:e.map((e,t)=>{let n=e.quantity??0,r=e.deliveredQuantity??null,i=e.delivered===!1,a=r!=null&&n>0&&r<n,o=e.delivered===!0||r!=null&&n>0&&r>=n;return(0,U.jsxs)(`div`,{style:{padding:`12px 14px`,borderRadius:10,background:t%2==0?`#FAFAF9`:`#fff`,border:`1px solid ${c.colors.border}`},children:[(0,U.jsxs)(`div`,{style:{display:`flex`,alignItems:`flex-start`,justifyContent:`space-between`,gap:12,marginBottom:6},children:[(0,U.jsx)(`div`,{style:{fontSize:13,fontWeight:600,color:v.textPrimary,flex:1,minWidth:0},children:e.description||`No description`}),o&&(0,U.jsxs)(`span`,{style:{display:`inline-flex`,alignItems:`center`,gap:4,fontSize:11,fontWeight:600,background:`#F0FDF4`,color:`#15803D`,padding:`2px 8px`,borderRadius:10,flexShrink:0},children:[(0,U.jsx)(h,{size:11}),` Delivered`]}),(i||a)&&!o&&(0,U.jsxs)(`span`,{style:{display:`inline-flex`,alignItems:`center`,gap:4,fontSize:11,fontWeight:600,background:`#FEF3C7`,color:`#B45309`,padding:`2px 8px`,borderRadius:10,flexShrink:0},children:[(0,U.jsx)(b,{size:11}),` Short`]})]}),(0,U.jsxs)(`div`,{style:{display:`flex`,gap:16,flexWrap:`wrap`,fontSize:12,color:v.textSecondary},children:[e.dtItemCode&&(0,U.jsxs)(`span`,{children:[(0,U.jsx)(`span`,{style:{fontWeight:600},children:`SKU:`}),` `,e.dtItemCode]}),e.quantity!=null&&(0,U.jsxs)(`span`,{children:[(0,U.jsx)(`span`,{style:{fontWeight:600},children:`Qty:`}),` `,e.quantity]}),e.deliveredQuantity!=null&&(0,U.jsxs)(`span`,{children:[(0,U.jsx)(`span`,{style:{fontWeight:600},children:`Delivered:`}),` `,(0,U.jsx)(`span`,{style:{color:a?`#B45309`:`#15803D`},children:e.deliveredQuantity})]}),e.checkedQuantity!=null&&e.checkedQuantity!==e.deliveredQuantity&&(0,U.jsxs)(`span`,{children:[(0,U.jsx)(`span`,{style:{fontWeight:600},children:`Checked:`}),` `,e.checkedQuantity]}),e.dtLocation&&(0,U.jsxs)(`span`,{children:[(0,U.jsx)(`span`,{style:{fontWeight:600},children:`Location:`}),` `,e.dtLocation]}),e.unitPrice!=null&&e.unitPrice>0&&(0,U.jsxs)(`span`,{children:[(0,U.jsx)(`span`,{style:{fontWeight:600},children:`Amount:`}),` $`,e.unitPrice.toFixed(2)]})]}),e.itemNote&&(0,U.jsxs)(`div`,{style:{fontSize:12,color:`#92400E`,marginTop:6,padding:`6px 8px`,background:`#FFFBEB`,borderRadius:6,borderLeft:`3px solid #F59E0B`},children:[(0,U.jsx)(`span`,{style:{fontWeight:600},children:`Driver note:`}),` `,e.itemNote]}),e.returnCodes&&e.returnCodes.length>0&&(0,U.jsxs)(`div`,{style:{fontSize:11,color:`#991B1B`,marginTop:6,fontWeight:500},children:[`Return codes: `,e.returnCodes.join(`, `)]}),e.notes&&(0,U.jsx)(`div`,{style:{fontSize:11,color:v.textMuted,marginTop:6,fontStyle:`italic`},children:e.notes})]},e.id||t)})}),(0,U.jsx)(`div`,{style:{fontSize:11,color:v.textMuted,marginTop:12,fontStyle:`italic`},children:`Items can't be edited here — cancel and recreate the order to change items.`})]})}function Z(e){if(!e)return`—`;try{return new Date(e).toLocaleString(`en-US`,{month:`short`,day:`numeric`,hour:`numeric`,minute:`2-digit`})}catch{return e}}function Q(e){if(e==null)return`—`;if(e<60)return`${e} min`;let t=Math.floor(e/60),n=e%60;return n===0?`${t}h`:`${t}h ${n}m`}function we({order:e,notes:t,history:n,photos:i,loading:a}){if(!(e.startedAt||e.finishedAt||e.driverName||e.truckName||e.signatureCapturedAt||e.codAmount!=null||e.dtStatusCode)&&n.length===0&&t.length===0&&i.length===0)return(0,U.jsx)(S,{children:(0,U.jsx)(`div`,{style:{textAlign:`center`,color:v.textMuted,fontSize:13,padding:`24px 0`},children:a?`Loading completion data…`:e.pushedToDtAt?`No driver activity yet. Click "DT Sync" on the Orders page to pull the latest from DispatchTrack.`:`This order hasn't been pushed to DispatchTrack yet.`})});let o=e.actualServiceTimeMinutes;return(0,U.jsxs)(`div`,{style:{display:`flex`,flexDirection:`column`,gap:16},children:[(e.driverName||e.truckName||e.serviceUnit||e.stopNumber!=null)&&(0,U.jsxs)(S,{children:[(0,U.jsx)(X,{children:`Driver & Vehicle`}),(0,U.jsx)(J,{label:`Driver`,value:e.driverName||null,icon:(0,U.jsx)(u,{size:11})}),(0,U.jsx)(J,{label:`Truck`,value:e.truckName?`${e.truckName}${e.truckId?` (#${e.truckId})`:``}`:null,icon:(0,U.jsx)(r,{size:11})}),(0,U.jsx)(J,{label:`Service Unit`,value:e.serviceUnit||null}),(0,U.jsx)(J,{label:`Stop #`,value:e.stopNumber==null?null:String(e.stopNumber)})]}),(0,U.jsxs)(S,{children:[(0,U.jsx)(X,{children:`Timing`}),(0,U.jsx)(J,{label:`Scheduled`,value:Z(e.scheduledAt),icon:(0,U.jsx)(T,{size:11})}),(0,U.jsx)(J,{label:`Started`,value:Z(e.startedAt),icon:(0,U.jsx)(C,{size:11})}),(0,U.jsx)(J,{label:`Finished`,value:Z(e.finishedAt),icon:(0,U.jsx)(h,{size:11})}),o!=null&&(0,U.jsx)(J,{label:`Actual Service Time`,value:Q(o),icon:(0,U.jsx)(de,{size:11})}),e.dtStatusCode&&(0,U.jsx)(J,{label:`DT Status Code`,value:e.dtStatusCode})]}),(e.codAmount!=null||e.paymentCollected||e.signatureCapturedAt)&&(0,U.jsxs)(S,{children:[(0,U.jsx)(X,{children:`Proof of Delivery`}),e.codAmount!=null&&(0,U.jsx)(J,{label:`COD Amount`,value:G(e.codAmount),icon:(0,U.jsx)(y,{size:11})}),e.paymentCollected&&(0,U.jsx)(J,{label:`Payment Collected`,value:`Yes`,icon:(0,U.jsx)(y,{size:11})}),e.paymentNotes&&(0,U.jsx)(J,{label:`Payment Notes`,value:e.paymentNotes}),e.signatureCapturedAt&&(0,U.jsx)(J,{label:`Signature Captured`,value:Z(e.signatureCapturedAt),icon:(0,U.jsx)(A,{size:11})})]}),i.length>0&&(0,U.jsxs)(S,{children:[(0,U.jsxs)(X,{children:[`POD Photos (`,i.length,`)`]}),(0,U.jsx)(`div`,{style:{display:`grid`,gridTemplateColumns:`repeat(auto-fill, minmax(140px, 1fr))`,gap:10},children:i.map(e=>(0,U.jsxs)(`a`,{href:e.fullUrl??`#`,target:`_blank`,rel:`noopener noreferrer`,style:{display:`block`,borderRadius:8,overflow:`hidden`,border:`1px solid ${c.colors.border}`,background:`#FAFAF9`,textDecoration:`none`,color:`inherit`},title:e.capturedAt?Z(e.capturedAt):e.dtImageName,onClick:t=>{e.fullUrl||t.preventDefault()},children:[e.thumbnailUrl?(0,U.jsx)(`img`,{src:e.thumbnailUrl,alt:e.dtImageName,loading:`lazy`,style:{width:`100%`,height:120,objectFit:`cover`,display:`block`}}):(0,U.jsx)(`div`,{style:{width:`100%`,height:120,display:`flex`,alignItems:`center`,justifyContent:`center`,fontSize:11,color:v.textMuted},children:e.fetchError?`Fetch failed`:`Loading…`}),e.capturedAt&&(0,U.jsx)(`div`,{style:{fontSize:10,color:v.textMuted,padding:`4px 6px`,borderTop:`1px solid ${c.colors.border}`},children:Z(e.capturedAt)})]},e.id))})]}),t.length>0&&(0,U.jsxs)(S,{children:[(0,U.jsx)(X,{children:(0,U.jsxs)(`span`,{style:{display:`inline-flex`,alignItems:`center`,gap:6},children:[(0,U.jsx)(le,{size:11}),` DT Notes (`,t.length,`)`]})}),(0,U.jsx)(`div`,{style:{display:`flex`,flexDirection:`column`,gap:8},children:t.map(e=>(0,U.jsxs)(`div`,{style:{padding:`8px 10px`,background:`#F8FAFC`,borderRadius:8,border:`1px solid ${c.colors.border}`},children:[(0,U.jsx)(`div`,{style:{fontSize:12,color:v.textPrimary,whiteSpace:`pre-wrap`},children:e.body}),(0,U.jsxs)(`div`,{style:{fontSize:10,color:v.textMuted,marginTop:4},children:[e.authorName||`DispatchTrack`,e.authorType&&e.authorType!==`system`?` · ${e.authorType}`:``,e.createdAtDt?` · ${Z(e.createdAtDt)}`:``]})]},e.id))})]})]})}function $(){let{orderId:e}=o(),t=i(),{user:r}=n(),a=r?.role===`admin`||r?.role===`staff`,{order:s,status:l,error:u,refetch:d}=fe(e),[f,m]=(0,j.useState)(null);(0,j.useEffect)(()=>{s&&m(s)},[s]);let h=f??s,[_,v]=(0,j.useState)(!1),[y,x]=(0,j.useState)(()=>ve(h||{})),[C,w]=(0,j.useState)(!1),[T,E]=(0,j.useState)(null),[k,le]=(0,j.useState)([]),[A,ue]=(0,j.useState)([]),[de,M]=(0,j.useState)([]),[N,P]=(0,j.useState)(!1);(0,j.useEffect)(()=>{if(!h?.id)return;let e=!1;return P(!0),Promise.all([ae(h.id),oe(h.id),se(h.id)]).then(([t,n,r])=>{e||(le(t),ue(n),M(r))}).finally(()=>{e||P(!1)}),()=>{e=!0}},[h?.id,h?.lastSyncedAt]);let F=(0,j.useCallback)(async e=>{if(!h)return;let t=e===`rejected`?`Reason for rejecting (will be emailed to the submitter):`:`What revisions are needed? (will be emailed to the submitter):`,n=window.prompt(t,h.reviewNotes||``);if(n!==null){w(!0),E(null);try{let{data:t}=await D.auth.getUser(),i=t?.user?.id??null,a=`Stride Reviewer`;if(i){let{data:e}=await D.from(`profiles`).select(`display_name, email`).eq(`id`,i).maybeSingle();a=e?.display_name||e?.email||a}let{error:o}=await D.from(`dt_orders`).update({review_status:e,review_notes:n.trim()||null,reviewed_by:i,reviewed_at:new Date().toISOString()}).eq(`id`,h.id);if(o)throw o;g({orderId:h.id,tenantId:h.tenantId,action:e===`rejected`?`reject`:`revision_requested`,changes:{reviewStatus:{old:h.reviewStatus,new:e},reviewerName:a,reviewNotes:n.trim()||null},performedBy:r?.email??null});try{let{data:t,error:r}=await D.functions.invoke(`notify-order-revision`,{body:{orderId:h.id,action:e,reviewerName:a,reviewNotes:n.trim()}});r?console.warn(`[OrderPage] notify-order-revision invoke error:`,r.message):t&&t.ok===!1&&console.warn(`[OrderPage] notify-order-revision returned ok:false`,t)}catch(e){console.warn(`[OrderPage] notify-order-revision threw`,e)}let s=await O(h.id);s&&m(s),d()}catch(e){E(e instanceof Error?e.message:String(e))}finally{w(!1)}}},[h,d,r?.email]),[I,L]=(0,j.useState)(!1),[R,z]=(0,j.useState)(!1),[B,V]=(0,j.useState)(null),[me,H]=(0,j.useState)(!1);(0,j.useEffect)(()=>{h&&!_&&x(ve(h))},[h,_]);let he=(0,j.useCallback)((e,t)=>{x(n=>({...n,[e]:t}))},[]),_e=(0,j.useCallback)(()=>{h&&x(ve(h)),E(null),v(!0)},[h]),G=(0,j.useCallback)(()=>{v(!1),E(null)},[]),ye=(0,j.useCallback)(async()=>{if(h){w(!0),E(null);try{let{data:e}=await D.auth.getUser(),t=e?.user?.id??null,n={contact_name:y.contactName.trim()||null,contact_address:y.contactAddress.trim()||null,contact_city:y.contactCity.trim()||null,contact_state:y.contactState.trim()||null,contact_zip:y.contactZip.trim()||null,contact_phone:y.contactPhone.trim()||null,contact_email:y.contactEmail.trim()||null,local_service_date:y.localServiceDate||null,window_start_local:y.windowStartLocal||null,window_end_local:y.windowEndLocal||null,po_number:y.poNumber.trim()||null,sidemark:y.sidemark.trim()||null,client_reference:y.clientReference.trim()||null,details:y.details.trim()||null,review_status:y.reviewStatus,review_notes:y.reviewNotes.trim()||null,reviewed_by:t,reviewed_at:new Date().toISOString()},i=y.orderTotal===``?null:Number(y.orderTotal),a=y.baseDeliveryFee===``?null:Number(y.baseDeliveryFee),o=i!==h.orderTotal||a!==h.baseDeliveryFee;o&&(n.order_total=i,n.base_delivery_fee=a,n.pricing_override=!0);let{error:s}=await D.from(`dt_orders`).update(n).eq(`id`,h.id);if(s)throw s;let c=[];if(y.contactName!==(h.contactName??``)&&c.push(`contactName`),y.contactAddress!==(h.contactAddress??``)&&c.push(`contactAddress`),y.contactCity!==(h.contactCity??``)&&c.push(`contactCity`),y.contactState!==(h.contactState??``)&&c.push(`contactState`),y.contactZip!==(h.contactZip??``)&&c.push(`contactZip`),y.contactPhone!==(h.contactPhone??``)&&c.push(`contactPhone`),y.contactEmail!==(h.contactEmail??``)&&c.push(`contactEmail`),y.localServiceDate!==(h.localServiceDate??``)&&c.push(`localServiceDate`),y.windowStartLocal!==(h.windowStartLocal??``).slice(0,5)&&c.push(`windowStartLocal`),y.windowEndLocal!==(h.windowEndLocal??``).slice(0,5)&&c.push(`windowEndLocal`),y.poNumber!==(h.poNumber??``)&&c.push(`poNumber`),y.sidemark!==(h.sidemark??``)&&c.push(`sidemark`),y.clientReference!==(h.clientReference??``)&&c.push(`clientReference`),y.details!==(h.details??``)&&c.push(`details`),y.reviewStatus!==h.reviewStatus&&c.push(`reviewStatus`),y.reviewNotes!==(h.reviewNotes??``)&&c.push(`reviewNotes`),o&&c.push(`pricing`),g({orderId:h.id,tenantId:h.tenantId,action:`update`,changes:{fieldsChanged:c,...y.reviewStatus===h.reviewStatus?{}:{reviewStatus:{old:h.reviewStatus,new:y.reviewStatus}},...o?{orderTotal:{old:h.orderTotal,new:i},baseDeliveryFee:{old:h.baseDeliveryFee,new:a}}:{}},performedBy:r?.email??null}),(y.reviewStatus===`revision_requested`||y.reviewStatus===`rejected`)&&y.reviewStatus!==h.reviewStatus){let e=`Stride Reviewer`;if(t){let{data:n}=await D.from(`profiles`).select(`display_name, email`).eq(`id`,t).maybeSingle();e=n?.display_name||n?.email||e}try{let{data:t,error:n}=await D.functions.invoke(`notify-order-revision`,{body:{orderId:h.id,action:y.reviewStatus,reviewerName:e,reviewNotes:y.reviewNotes.trim()}});n?console.warn(`[OrderPage] notify-order-revision invoke error:`,n.message):t&&t.ok===!1&&console.warn(`[OrderPage] notify-order-revision returned ok:false`,t)}catch(e){console.warn(`[OrderPage] notify-order-revision threw`,e)}}v(!1);let l=await O(h.id);l&&m(l),d()}catch(e){E(e instanceof Error?e.message:String(e))}finally{w(!1)}}},[h,y,d,r?.email]);if(l===`loading`)return(0,U.jsxs)(`div`,{style:{display:`flex`,flexDirection:`column`,alignItems:`center`,justifyContent:`center`,height:`100%`,gap:16,color:c.colors.textMuted},children:[(0,U.jsx)(ee,{size:32,style:{animation:`spin 1s linear infinite`}}),(0,U.jsx)(`div`,{style:{fontSize:14},children:`Loading order…`}),(0,U.jsx)(`style`,{children:`@keyframes spin { to { transform: rotate(360deg) } }`})]});if(l===`not-found`)return(0,U.jsx)(xe,{icon:ce,color:c.colors.textMuted,title:`Order Not Found`,body:`No order found with this ID.`,actions:(0,U.jsx)(`button`,{onClick:()=>t(`/orders`),style:be,children:`Back to Orders`})});if(l===`error`)return(0,U.jsx)(xe,{icon:b,color:c.colors.statusRed,title:`Failed to Load Order`,body:u||`An unexpected error occurred.`,actions:(0,U.jsxs)(`div`,{style:{display:`flex`,gap:12},children:[(0,U.jsx)(`button`,{onClick:d,style:{...be,color:c.colors.primary},children:`Retry`}),(0,U.jsx)(`button`,{onClick:()=>t(`/orders`),style:be,children:`Back to Orders`})]})});if(!h)return null;let K=ge[h.statusCategory]||ge.open,q=h.reviewStatus&&h.reviewStatus!==`not_required`?W[h.reviewStatus]:null,J=(0,U.jsxs)(`span`,{style:{display:`inline-flex`,alignItems:`center`,gap:6,flexWrap:`wrap`},children:[h.isPickup&&(0,U.jsx)(`span`,{style:{fontSize:10,fontWeight:700,background:`#FEF3C7`,color:`#B45309`,padding:`2px 8px`,borderRadius:10,letterSpacing:`1px`,textTransform:`uppercase`},children:`PICKUP`}),(0,U.jsx)(`span`,{style:{fontSize:12,fontWeight:600,background:K.bg,color:K.color,padding:`3px 10px`,borderRadius:12},children:h.statusName||K.label}),q&&(0,U.jsxs)(`span`,{style:{fontSize:12,fontWeight:600,background:q.bg,color:q.color,padding:`3px 10px`,borderRadius:12,display:`inline-flex`,alignItems:`center`,gap:4},children:[q.icon,q.label]})]}),Y=[{id:`details`,label:`Details`,keepMounted:!0,render:()=>(0,U.jsx)(Se,{order:h,editing:_,edit:y,setField:he,saving:C,saveError:T,onStartEdit:_e,onCancelEdit:G,onSave:ye})},{id:`items`,label:`Items`,badgeCount:h.items?.length??0,render:()=>(0,U.jsx)(Ce,{items:h.items??[]})},{id:`completion`,label:`Completion`,badgeCount:A.length>0?A.length:void 0,render:()=>(0,U.jsx)(we,{order:h,notes:A,history:k,photos:de,loading:N})},{id:`activity`,label:`Activity`,render:()=>(0,U.jsx)(S,{children:(0,U.jsx)(te,{entityType:`dt_order`,entityId:h.id,tenantId:h.tenantId??void 0})})}],X=(()=>{let e=new Set,t=[];for(let n of h.items??[]){let r=n.inventoryId||n.dtItemCode;!r||e.has(r)||(e.add(r),t.push(n))}return t})(),Z=h.statusCategory===`completed`&&!!h.tenantId&&X.length>0,Q=_?null:(0,U.jsx)(p,{label:`Print PDF`,variant:`secondary`,onClick:()=>pe(h)},`print-pdf`),$=a&&!_?(0,U.jsxs)(U.Fragment,{children:[Q,(0,U.jsx)(p,{label:`Edit Full Order`,variant:`secondary`,onClick:()=>L(!0)}),Z&&(0,U.jsx)(p,{label:`Release Items`,variant:`primary`,onClick:()=>H(!0)}),(h.reviewStatus===`pending_review`||h.reviewStatus===`revision_requested`)&&(0,U.jsxs)(U.Fragment,{children:[(0,U.jsx)(p,{label:`Approve`,variant:`primary`,onClick:async()=>{await D.from(`dt_orders`).update({review_status:`approved`,reviewed_at:new Date().toISOString()}).eq(`id`,h.id),g({orderId:h.id,tenantId:h.tenantId,action:`approve`,changes:{reviewStatus:{old:h.reviewStatus,new:`approved`}},performedBy:r?.email??null});let e=await O(h.id);e&&m(e),d()}}),(0,U.jsx)(p,{label:`Request Revision`,variant:`secondary`,onClick:()=>F(`revision_requested`)}),(0,U.jsx)(p,{label:`Reject`,variant:`secondary`,onClick:()=>F(`rejected`)})]}),h.reviewStatus===`approved`&&!h.pushedToDtAt&&(0,U.jsx)(p,{label:R?`Pushing…`:`Push to DT`,variant:`primary`,onClick:async()=>{if(!R){z(!0),V(null);try{let{data:e,error:t}=await D.functions.invoke(`dt-push-order`,{body:{orderId:h.id}});if(t){let e=t.message;try{let n=t.context;if(n?.json){let t=await n.json();t?.error&&(e=t.error,t.responseBody&&(e+=` (DT response: ${t.responseBody.slice(0,200)})`))}}catch{}throw Error(e)}let n=e;if(!n?.ok)throw Error(n?.error||`DT push failed`);g({orderId:h.id,tenantId:h.tenantId,action:`push_to_dt`,changes:{dtIdentifier:n.dt_identifier??h.dtIdentifier,...n.linked_identifier?{linkedIdentifier:n.linked_identifier}:{},orderType:h.orderType,itemCount:h.items?.length??0},performedBy:r?.email??null}),n.linked_identifier&&h.linkedOrderId&&g({orderId:h.linkedOrderId,tenantId:h.tenantId,action:`push_to_dt`,changes:{dtIdentifier:n.linked_identifier,linkedIdentifier:n.dt_identifier??h.dtIdentifier,pushedAlongsideDelivery:!0},performedBy:r?.email??null});let i=await O(h.id);i&&m(i),d()}catch(e){let t=e instanceof Error?e.message:String(e);console.error(`[OrderPage] DT push failed:`,t,e),V(t)}finally{z(!1)}}}})]}):Q,Te=$!==null&&j.Children.count($)>0;return(0,U.jsxs)(U.Fragment,{children:[B&&(0,U.jsxs)(`div`,{role:`alert`,style:{position:`fixed`,top:16,left:`50%`,transform:`translateX(-50%)`,zIndex:1100,padding:`14px 18px`,background:`#FEF2F2`,border:`1px solid #FCA5A5`,color:`#991B1B`,borderRadius:10,fontSize:13,maxWidth:720,boxShadow:`0 8px 24px rgba(0,0,0,0.15)`,display:`flex`,alignItems:`flex-start`,gap:10},children:[(0,U.jsxs)(`div`,{style:{flex:1,minWidth:0},children:[(0,U.jsx)(`div`,{style:{fontWeight:700,marginBottom:4},children:`DT push failed`}),(0,U.jsx)(`div`,{style:{fontWeight:400,whiteSpace:`pre-wrap`,wordBreak:`break-word`},children:B})]}),(0,U.jsx)(`button`,{onClick:()=>V(null),style:{background:`none`,border:`none`,cursor:`pointer`,color:`#991B1B`,fontWeight:700,fontSize:18,lineHeight:1,padding:0,flexShrink:0},"aria-label":`Dismiss`,children:`×`})]}),(0,U.jsx)(re,{entityLabel:`ORDER`,entityId:h.dtIdentifier||h.id.slice(0,8).toUpperCase(),statusBadge:J,clientName:h.clientName||void 0,tabs:Y,initialTabId:`details`,footer:Te?$:void 0}),I&&(0,U.jsx)(ne,{editOrderId:h.id,onClose:()=>L(!1),onSubmit:async()=>{L(!1);let e=await O(h.id);e&&m(e),d()}}),me&&h.tenantId&&(0,U.jsx)(ie,{itemIds:X.map(e=>e.dtItemCode||e.inventoryId),clientName:h.clientName||`this client`,clientSheetId:h.tenantId,defaultReleaseDate:h.finishedAt?h.finishedAt.slice(0,10):void 0,selectableItems:X.map(e=>({id:e.dtItemCode||e.inventoryId,label:e.description||e.dtItemCode||`Item`,sublabel:[e.dtItemCode&&`SKU ${e.dtItemCode}`,e.quantity!=null&&`Qty ${e.quantity}`].filter(Boolean).join(` · `)||void 0})),onClose:()=>H(!1),onSuccess:async()=>{let e=await O(h.id);e&&m(e),d()}})]})}export{$ as OrderPage};