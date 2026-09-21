export type BillingLocale='en'|'ru';
export type BillingPlan={id:'mini'|'start'|'economy';name:Record<BillingLocale,string>;keys:number;priceMinor:number;currency:'USD';savingPercent:number;sortOrder:number;active:boolean};

export const billingPlans:BillingPlan[]=[
 {id:'mini',name:{en:'Mini',ru:'Мини'},keys:3,priceMinor:300,currency:'USD',savingPercent:0,sortOrder:1,active:true},
 {id:'start',name:{en:'Start',ru:'Старт'},keys:10,priceMinor:1000,currency:'USD',savingPercent:0,sortOrder:2,active:true},
 {id:'economy',name:{en:'Economy',ru:'Экономный'},keys:35,priceMinor:3000,currency:'USD',savingPercent:14,sortOrder:3,active:true},
];

export const activeBillingPlans=()=>billingPlans.filter(plan=>plan.active).sort((a,b)=>a.sortOrder-b.sortOrder);
export const money=(minor:number,currency:string,locale:BillingLocale='en')=>new Intl.NumberFormat(locale==='ru'?'ru-RU':'en-US',{style:'currency',currency,maximumFractionDigits:minor%100?2:0}).format(minor/100);
