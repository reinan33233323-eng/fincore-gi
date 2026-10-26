import { FormEvent, ReactNode, useEffect, useRef, useState } from 'react';
import { Trash2, X } from 'lucide-react';
import CreditInvoiceView from './CreditInvoiceView';
import { BankPicker } from './BankLogo';
import { adjustCardInvoice, saveCreditCard, saveCardPurchases, payCreditInvoice, deleteCardPurchase, cancelCardSeries, signedAttachmentUrl, addCardPartialPayment, deleteCardPartialPayment, type Bank } from '../lib/bridge';
import { invoiceDate, invoiceCycle, invoiceMonthSummary, type CardPayment, type CreditCard } from '../lib/credit';
import { cardSchedule } from '../lib/cardLedger';
import { addDays, defaultBankId, shiftWeeklyDate } from '../lib/recurrence';
import { addMonthsClamped, changedSeriesFields, seriesDueDate } from '../lib/seriesDates';
import { localDateKey, localMonthKey } from '../lib/finance';
import { CurrencyInput, fmt, parseMoney } from './shared';

const field='mt-1 block w-full rounded-xl border bg-zinc-50 p-2.5 text-sm font-normal';
const button='rounded-full bg-[#831843] px-4 py-2.5 hover:bg-pink-950 shadow-[0_8px_20px_-10px_rgba(24,24,27,0.8)] text-sm font-bold text-white disabled:opacity-50';
type Props={categories?:any[];payments?:CardPayment[];cards:CreditCard[];setCards:(fn:(old:CreditCard[])=>CreditCard[])=>void;banks:Bank[];entries:any[];focus?:{cardId:string;month:string}|null;
 onRefresh:()=>Promise<void>;onPlans:()=>void;onEntries:(month:string)=>void;
 renderForm:(editing:any,save:(data:any,scope:'one'|'series',parts?:{date:string;amount:string}[])=>Promise<void>,close:()=>void,card:CreditCard,onDelete?:()=>void)=>ReactNode};
export default function CreditCards({cards,setCards,banks,entries,onRefresh,onPlans,onEntries,renderForm,focus,payments=[],categories:categoryDefinitions=[]}:Props) {
 const today=localDateKey(new Date());
 const pendingSave=useRef<{key:string;rows:any[]}|null>(null);
 const [cardId,setCardId]=useState(focus?.cardId||cards[0]?.id||''),[month,setMonth]=useState(()=>focus?.month||(cards.find(c=>c.id===(focus?.cardId||cards[0]?.id))?invoiceDate(today,cards.find(c=>c.id===(focus?.cardId||cards[0]?.id))!).slice(0,7):localMonthKey(new Date())));
 const [followCurrentCycle,setFollowCurrentCycle]=useState(!focus?.month);
 const [name,setName]=useState(''),[closing,setClosing]=useState('25'),[due,setDue]=useState('5'),[editing,setEditing]=useState('');
 const [bank,setBank]=useState(defaultBankId(banks)||banks[0]?.id||''),[paymentDate,setPaymentDate]=useState(today);
 const [purchaseOpen,setPurchaseOpen]=useState(false),[editingPurchase,setEditingPurchase]=useState<any>(null);
 const [search,setSearch]=useState(''),[category,setCategory]=useState('Todas'),[center,setCenter]=useState('Todos'),[statusFilter,setStatusFilter]=useState('todos');
 const [cardFormOpen,setCardFormOpen]=useState(!cards.length),[paymentOpen,setPaymentOpen]=useState(false);
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
 const card=cards.find(c=>c.id===cardId);
 const all=entries.filter(e=>e.creditCardId===cardId);
 const selectedSummary=invoiceMonthSummary(entries,cardId,month);
 const invoice=selectedSummary.items;
 const nextMonth=addMonthsClamped(`${month}-01`,1).slice(0,7);
 const nextSummary=invoiceMonthSummary(entries,cardId,nextMonth);
 const cycle=card?invoiceCycle(month,card):null;
 const monthLabel=(value:string)=>new Date(`${value}-01T12:00:00`).toLocaleDateString('pt-BR',{month:'long',year:'numeric'});
 const selectMonth=(value:string,follow=false)=>{setMonth(value);setFollowCurrentCycle(follow);setCategory('Todas');setCenter('Todos');setStatusFilter('todos');};
 const unpaid=all.filter(e=>e.invoiceMonth===month&&!e.cardPayment&&e.status==='previsto');
 const total=selectedSummary.pending;
 useEffect(()=>{if(followCurrentCycle&&card){const current=invoiceDate(today,card).slice(0,7);if(month!==current){setMonth(current);setCategory('Todas');setCenter('Todos');setStatusFilter('todos');}}},[followCurrentCycle,card?.id,card?.closing_day,card?.due_day,today,month]);
 const list=invoice.filter(e=>(category==='Todas'||e.category===category)&&(center==='Todos'||e.unit===center)&&(statusFilter==='todos'||e.status===statusFilter)&&`${e.description} ${e.beneficiary} ${e.category}`.toLowerCase().includes(search.toLowerCase()));
 const run=async(fn:()=>Promise<void>)=>{setBusy(true);setError('');setMessage('');try{await fn();}catch(e){setError(e instanceof Error?e.message:'Não foi possível salvar.');}finally{setBusy(false);}};
 const save=(e:FormEvent)=>{e.preventDefault();void run(async()=>{
 const saved=await saveCreditCard({id:editing||crypto.randomUUID(),name:name.trim(),closing_day:Number(closing),due_day:Number(due)});
 setCards(old=>[...old.filter(c=>c.id!==saved.id),saved].sort((a,b)=>a.name.localeCompare(b.name)));
 setCardId(saved.id);selectMonth(invoiceDate(today,saved).slice(0,7),true);setEditing('');setName('');setCardFormOpen(false);setMessage('Cartão salvo.');
 });};
 const savePurchase=async(data:any,scope:'one'|'series',parts?:{date:string;amount:string}[])=>{
  if(!card)throw new Error('Selecione um cartão.');
  let rows:any[];
  if(editingPurchase){
   const selected=editingPurchase;
   const occurrences=scope==='series'&&selected.seriesId?all.filter(e=>e.seriesId===selected.seriesId&&e.status==='previsto'):all.filter(e=>e.id===selected.id&&e.status==='previsto');
   if(!occurrences.length)throw new Error('Compras de faturas já pagas são preservadas.');
   const changes=scope==='series'?changedSeriesFields({...selected,date:selected.cardPurchaseDate||selected.date},data,['date']):data;
   const dates=occurrences.map(e=>({...e,date:e.cardPurchaseDate||e.date}));
   rows=occurrences.map(e=>{
    const originalDate=e.cardPurchaseDate||e.date;
    const dateChanged=data.date!==(selected.cardPurchaseDate||selected.date);
    const purchaseDate=!dateChanged?originalDate:scope==='series'&&e.recurrence==='mensal'?seriesDueDate(dates,{...selected,date:selected.cardPurchaseDate||selected.date},{...e,date:originalDate},data.date):scope==='series'&&e.recurrence==='semanal'?shiftWeeklyDate(originalDate,selected.cardPurchaseDate||selected.date,data.date):data.date;
    const date=dateChanged?invoiceDate(purchaseDate,card,e.cardInstallmentOffset||0):e.date;
    return {...e,...changes,id:e.id,seriesId:e.seriesId,installment:e.installment,installments:1,recurrence:e.recurrence,cardPurchaseDate:purchaseDate,
     cardInstallmentOffset:e.cardInstallmentOffset||0,date,invoiceMonth:date.slice(0,7),creditCardId:card.id,kind:'despesa',status:'previsto',bankId:null,paidDate:null,juros:0,discount:0};
   });
  }else{
   const key=JSON.stringify({data,parts,cardId:card.id});
   if(pendingSave.current?.key===key)rows=pendingSave.current.rows;
   else {
    const planned=cardSchedule(data,card,parts);
    const seriesId=planned.length>1||data.recurrence!=='nenhuma'?crypto.randomUUID():undefined;
    rows=planned.map(e=>({...e,id:crypto.randomUUID(),seriesId}));
    pendingSave.current={key,rows};
   }
  }
  await saveCardPurchases(rows);await onRefresh();pendingSave.current=null;
  // Series rows arrive newest first. Editing must keep the invoice and filters
  // the user opened, rather than navigate to the last generated occurrence.
  if(!editingPurchase){selectMonth(rows[0].invoiceMonth);setSearch('');}
  setMessage('Lançamentos salvos no cartão. A lista geral mostra o total da fatura.');
 };
 const [adjustmentOpen,setAdjustmentOpen]=useState(false),[adjustmentBalance,setAdjustmentBalance]=useState(''),[adjustmentNotes,setAdjustmentNotes]=useState('');
 const adjustmentExpected=useRef(0);
 const openAdjustment=()=>{adjustmentExpected.current=total;setAdjustmentBalance(String(total));setAdjustmentNotes('');setError('');setAdjustmentOpen(true);};
 const saveAdjustment=()=>void run(async()=>{
  const balance=parseMoney(adjustmentBalance);
  if(!card||!adjustmentBalance.trim()||!Number.isFinite(balance)||balance<0)throw new Error('Informe um saldo em aberto válido, maior ou igual a zero.');
  await adjustCardInvoice(card.id,month,balance,adjustmentExpected.current,adjustmentNotes.trim());
  await onRefresh();setAdjustmentOpen(false);setMessage('Saldo da fatura ajustado. Nenhum valor foi descontado da conta bancária.');
 });
 const [payMode,setPayMode]=useState<'total'|'partial'>('total'),[partialAmount,setPartialAmount]=useState('');
 const partials=payments.filter(row=>row.card_id===cardId&&row.invoice_month===month).sort((a,b)=>a.paid_date.localeCompare(b.paid_date));
 const payPartial=()=>void run(async()=>{
  const amount=parseMoney(partialAmount);
  if(!card||!bank||!Number.isFinite(amount)||amount<=0)throw new Error('Informe o valor e a conta do pagamento parcial.');
  if(Math.round(amount*100)>Math.round(total*100))throw new Error(`O valor é maior que o saldo em aberto (${fmt(total)}).`);
  await addCardPartialPayment(card.id,month,bank,amount,paymentDate);await onRefresh();setPaymentOpen(false);setPartialAmount('');
  setMessage(`Pagamento parcial de ${fmt(amount)} registrado. A fatura continua aberta com ${fmt(Math.round((total-amount)*100)/100)}.`);
 });
 const removePartial=(row:CardPayment)=>void run(async()=>{if(!window.confirm(`Excluir o pagamento parcial de ${fmt(Number(row.amount))}? O valor volta para o saldo da conta.`))return;await deleteCardPartialPayment(row.id);await onRefresh();setMessage('Pagamento parcial excluído.');});
 const pay=()=>void run(async()=>{
 if(!card||!bank||!unpaid.length)throw new Error('Selecione uma fatura em aberto e a conta bancária.');
 await payCreditInvoice(card.id,month,bank,paymentDate);await onRefresh();setPaymentOpen(false);setMessage('Pagamento registrado. O saldo da conta já foi atualizado.');
 });
 // One confirmation dialog for every delete path: row, expanded details and the edit form.
 const [deleting,setDeleting]=useState<any>(null);
 const removeOne=(entry:any)=>void run(async()=>{setDeleting(null);await deleteCardPurchase(entry.id);await onRefresh();setMessage('Compra excluída.');});
 const removeSeries=(entry:any)=>void run(async()=>{setDeleting(null);await cancelCardSeries(entry.seriesId);await onRefresh();setMessage('Série excluída. Compras de faturas já pagas foram mantidas.');});
 const askDelete=(entry:any)=>{setPurchaseOpen(false);setEditingPurchase(null);setDeleting(entry);};
 const newCard=()=>{setEditing('');setName('');setClosing('25');setDue('5');setCardFormOpen(true);};
 const editCard=()=>{if(card){setEditing(card.id);setName(card.name);setClosing(String(card.closing_day));setDue(String(card.due_day));setCardFormOpen(true);}};
 return <div className="space-y-4">
 {error&&<p role="alert" className="mx-auto max-w-[920px] rounded-xl bg-red-50 p-3 text-sm font-bold text-red-700">{error}</p>}{message&&<p role="status" className="mx-auto max-w-[920px] rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800">{message}</p>}
 {card&&cycle?<CreditInvoiceView cards={cards} cardId={cardId} month={month} cycle={cycle} today={today}
   total={selectedSummary.total} paid={selectedSummary.paid} pending={total} nextTotal={nextSummary.total} invoice={invoice} rows={list} categories={categoryDefinitions} banks={banks}
   search={search} setSearch={setSearch} category={category} setCategory={setCategory} center={center} setCenter={setCenter} status={statusFilter} setStatus={setStatusFilter}
   selectCard={value=>{setCardId(value);const selected=cards.find(c=>c.id===value);if(selected)selectMonth(invoiceDate(today,selected).slice(0,7),true);}}
   selectMonth={selectMonth} previous={()=>selectMonth(addMonthsClamped(`${month}-01`,-1).slice(0,7))} next={()=>selectMonth(nextMonth)} current={()=>selectMonth(invoiceDate(today,card).slice(0,7),true)}
   add={()=>{pendingSave.current=null;setEditingPurchase(null);setPurchaseOpen(true);}} edit={entry=>{setEditingPurchase(entry);setPurchaseOpen(true);}} remove={askDelete} cancel={askDelete}
   attachment={path=>void run(async()=>{window.open(await signedAttachmentUrl(path),'_blank','noopener');})}
   editCard={editCard} addCard={newCard} plans={onPlans} entries={()=>onEntries(month)} pay={()=>{setError('');setPayMode('total');setPaymentOpen(true);}} busy={busy} adjustInvoice={openAdjustment} adjustments={selectedSummary.adjustments} canSettle={unpaid.length>0} partials={partials} removePartial={removePartial}
 />:<section className="mx-auto max-w-[920px] rounded-2xl bg-[#ffffff] p-8 text-center"><h2 className="font-bold">Seus cartões de crédito</h2><p className="mt-2 text-sm text-zinc-500">Cadastre um cartão para lançar compras, assinaturas e parcelamentos.</p><button onClick={newCard} className={`${button} mt-5`}>Cadastrar cartão</button></section>}
 {cardFormOpen&&<div className="fc-overlay fixed inset-0 z-40 flex items-center justify-center bg-black/30 p-4"><section role="dialog" aria-modal="true" aria-label={editing?'Editar cartão':'Cadastrar cartão'} className="w-full max-w-lg rounded-[1.5rem] bg-white p-6 shadow-2xl"><header className="flex items-center justify-between"><h2 className="font-bold">{editing?'Editar cartão':'Cadastrar cartão'}</h2><button aria-label="Fechar cadastro de cartão" onClick={()=>setCardFormOpen(false)}><X size={20}/></button></header><form onSubmit={save} className="mt-5 space-y-4"><label className="block text-xs font-bold">Nome do cartão<input className={field} required minLength={2} maxLength={80} value={name} onChange={e=>setName(e.target.value)}/></label><BankPicker name={name} onChange={setName} label="Banco do cartão"/><div className="grid grid-cols-2 gap-3"><label className="text-xs font-bold">Dia de fechamento<input className={field} type="number" min={1} max={31} required value={closing} onChange={e=>setClosing(e.target.value)}/></label><label className="text-xs font-bold">Dia de vencimento<input className={field} type="number" min={1} max={31} required value={due} onChange={e=>setDue(e.target.value)}/></label></div>{error&&<p role="alert" className="text-sm text-red-600">{error}</p>}<div className="flex justify-end gap-3"><button type="button" disabled={busy} onClick={()=>setCardFormOpen(false)} className="text-sm">Cancelar</button><button disabled={busy} className={button}>{busy?'Salvando…':'Salvar cartão'}</button></div></form></section></div>}
 {adjustmentOpen&&card&&<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"><section role="dialog" aria-modal="true" aria-label="Ajustar saldo da fatura" className="w-full max-w-lg rounded-3xl bg-white p-6 shadow-xl"><header className="flex items-center justify-between"><h2 className="font-semibold">Ajustar saldo da fatura</h2><button aria-label="Fechar ajuste" disabled={busy} onClick={()=>setAdjustmentOpen(false)}><X size={20}/></button></header><p className="mt-3 text-sm text-zinc-500">{card.name} · {monthLabel(month)}</p><p className="mt-3 rounded-xl bg-zinc-50 p-3 text-sm">Informe quanto ainda falta pagar no app do banco. Este ajuste não registra pagamento nem desconta dinheiro da conta.</p><form className="mt-4 space-y-4" onSubmit={e=>{e.preventDefault();saveAdjustment();}}><p className="text-sm text-zinc-500">Saldo atual no FinCore: <b>{fmt(adjustmentExpected.current)}</b></p><label className="block text-xs font-medium">Saldo em aberto no banco<CurrencyInput value={adjustmentBalance} onChange={setAdjustmentBalance} className="text-lg font-semibold"/></label><label className="block text-xs font-medium">Observação (opcional)<input value={adjustmentNotes} onChange={e=>setAdjustmentNotes(e.target.value)} maxLength={500} className={field}/></label>{error&&<p role="alert" className="text-sm text-red-600">{error}</p>}<div className="flex justify-end gap-2"><button type="button" disabled={busy} onClick={()=>setAdjustmentOpen(false)} className="rounded-full px-4 py-2 text-sm">Cancelar</button><button disabled={busy||!adjustmentBalance.trim()} className={button}>{busy?'Salvando…':'Salvar ajuste sem pagamento'}</button></div></form></section></div>}
 {paymentOpen&&card&&<div className="fc-overlay fixed inset-0 z-40 flex items-center justify-center bg-zinc-950/40 p-4 backdrop-blur-[2px]" role="presentation" onClick={()=>setPaymentOpen(false)}><section role="dialog" aria-modal="true" aria-label="Pagar fatura" onClick={e=>e.stopPropagation()} className="w-full max-w-lg rounded-[1.5rem] bg-white p-6 shadow-2xl">
  <header className="flex items-start justify-between gap-3"><div><h2 className="text-lg font-semibold tracking-[-0.02em]">Pagar fatura</h2><p className="mt-0.5 text-sm text-zinc-500">{card.name} · <span className="inline-block first-letter:uppercase">{monthLabel(month)}</span></p></div><button aria-label="Fechar pagamento da fatura" onClick={()=>setPaymentOpen(false)} className="rounded-full p-2 text-zinc-500 hover:rotate-90 hover:bg-zinc-100 hover:text-[#831843]"><X size={20}/></button></header>
  <div className="mt-4 grid grid-cols-3 gap-2 text-xs"><div className="fc-card-soft px-3 py-2"><p className="text-zinc-500">Fatura</p><b className="text-sm font-semibold">{fmt(selectedSummary.total)}</b></div><div className="fc-card-soft px-3 py-2"><p className="text-zinc-500">Já pago</p><b className="text-sm font-semibold text-emerald-600">{fmt(selectedSummary.paid)}</b></div><div className="fc-card-soft px-3 py-2"><p className="text-zinc-500">Em aberto</p><b className="text-sm font-semibold text-red-600">{fmt(total)}</b></div></div>
  <div role="radiogroup" aria-label="Tipo de pagamento" className="mt-4 grid grid-cols-2 gap-1 rounded-full bg-zinc-100 p-1 text-sm">{([['total','Pagar tudo'],['partial','Pagamento parcial']] as const).map(([mode,label])=><button key={mode} type="button" role="radio" aria-checked={payMode===mode} onClick={()=>setPayMode(mode)} className={`rounded-full py-2 font-medium ${payMode===mode?'bg-white text-[#831843] shadow-sm':'text-zinc-500 hover:text-[#831843]'}`}>{label}</button>)}</div>
  <p className="mt-3 text-xs leading-relaxed text-zinc-500">{payMode==='total'?`Quita a fatura: debita ${fmt(total)} da conta escolhida e marca todas as compras como pagas.`:'Adiantamento: o valor sai do saldo da conta agora e aparece em Lançamentos. A fatura continua aberta com o restante.'}</p>
  <form className="mt-4 space-y-4" onSubmit={e=>{e.preventDefault();if(payMode==='partial'){payPartial();return;}if(window.confirm(`Quitar a fatura pagando ${fmt(total)} pela conta ${banks.find(b=>b.id===bank)?.name}?`))pay();}}>
   {payMode==='partial'&&<label className="block text-xs font-medium text-zinc-600">Valor pago agora<CurrencyInput value={partialAmount} onChange={setPartialAmount} className="text-base font-semibold"/></label>}
   <div className="grid gap-3 sm:grid-cols-2"><label className="block text-xs font-medium text-zinc-600">Conta usada<select required className={field} value={bank} onChange={e=>setBank(e.target.value)}><option value="">Selecione</option>{banks.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</select></label><label className="block text-xs font-medium text-zinc-600">Data do pagamento<input className={field} type="date" max={today} required value={paymentDate} onChange={e=>setPaymentDate(e.target.value)}/></label></div>
   {partials.length>0&&<div className="rounded-2xl bg-zinc-50 p-3 text-xs"><p className="mb-1 font-medium text-zinc-600">Pagamentos parciais desta fatura</p>{partials.map(row=><div key={row.id} className="flex items-center justify-between gap-2 py-1"><span>{row.paid_date.split('-').reverse().join('/')} · {banks.find(b=>b.id===row.bank_id)?.name||'Conta'}</span><b className="font-semibold text-emerald-600">{fmt(Number(row.amount))}</b></div>)}</div>}
   {error&&<p role="alert" className="text-sm text-red-600">{error}</p>}
   <div className="flex justify-end gap-2"><button type="button" disabled={busy} onClick={()=>setPaymentOpen(false)} className="rounded-full px-4 py-2.5 text-sm text-zinc-600 hover:bg-zinc-100">Cancelar</button><button disabled={busy||!bank||!paymentDate||(payMode==='total'?!unpaid.length:!partialAmount)} className={button}>{busy?'Registrando…':payMode==='total'?(total>0?`Quitar ${fmt(total)}`:'Quitar fatura'):'Registrar pagamento parcial'}</button></div>
  </form>
 </section></div>}
 {purchaseOpen&&card&&renderForm(editingPurchase?{...editingPurchase,date:editingPurchase.cardPurchaseDate||editingPurchase.date}:null,savePurchase,()=>{setPurchaseOpen(false);setEditingPurchase(null);},card,editingPurchase&&editingPurchase.status==='previsto'?()=>askDelete(editingPurchase):undefined)}
 {deleting&&<div className="fc-overlay fixed inset-0 z-[60] flex items-center justify-center bg-zinc-950/40 p-4 backdrop-blur-[2px]" role="presentation" onClick={()=>setDeleting(null)}><section role="dialog" aria-modal="true" aria-label="Excluir compra do cartão" onClick={e=>e.stopPropagation()} className="w-full max-w-md rounded-[1.5rem] bg-white p-6 shadow-2xl">
  <span className="mb-4 flex h-11 w-11 items-center justify-center rounded-2xl bg-red-50 text-red-600"><Trash2 size={18}/></span>
  <h2 className="text-lg font-semibold tracking-[-0.02em]">Excluir “{deleting.description}”</h2>
  <p className="mt-1 text-sm text-zinc-500">{deleting.seriesId?(deleting.recurrence!=='nenhuma'?'Esta compra se repete todo mês no cartão.':'Esta compra é parcelada.')+' O que você quer excluir?':'Esta compra em aberto será removida da fatura.'}</p>
  <div className="mt-5 grid gap-2">
   <button disabled={busy} onClick={()=>removeOne(deleting)} className="rounded-2xl px-4 py-3 text-left text-sm ring-1 ring-zinc-200 hover:bg-zinc-50 disabled:opacity-50"><b className="block font-medium">{deleting.seriesId?'Só esta compra / parcela':'Excluir compra'}</b><span className="text-xs text-zinc-500">As demais ocorrências continuam.</span></button>
   {deleting.seriesId&&<button disabled={busy} onClick={()=>removeSeries(deleting)} className="rounded-2xl bg-red-600 px-4 py-3 text-left text-sm text-white shadow-[0_10px_24px_-12px_rgba(220,38,38,0.9)] hover:bg-red-700 disabled:opacity-50"><b className="block font-medium">{deleting.recurrence!=='nenhuma'?'Toda a série (cancelar recorrência)':'Todas as parcelas em aberto'}</b><span className="text-xs text-white/80">Exclui todas as ocorrências em aberto. Compras de faturas já pagas são mantidas.</span></button>}
   <button onClick={()=>setDeleting(null)} className="mt-1 rounded-full py-2 text-sm text-zinc-500 hover:text-[#831843]">Cancelar</button>
  </div>
 </section></div>}
 </div>;
}
