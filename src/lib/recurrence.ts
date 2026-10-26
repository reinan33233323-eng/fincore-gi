export function addDays(date: string, days: number) {
 const value = new Date(`${date}T12:00:00Z`);
 value.setUTCDate(value.getUTCDate() + days);
 return value.toISOString().slice(0,10);
}
export function nextWeeklyDates(lastDate: string, from: string, through: string) {
 const dates: string[] = [];
 for(let date=addDays(lastDate,7); date<=through; date=addDays(date,7)) {
  if(date>=from) dates.push(date);
 }
 return dates;
}
export function defaultBankId(banks: {id:string;name:string}[]) {
 const name=(value:string)=>value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
 return (banks.find(b=>name(b.name)==='itau') || banks.find(b=>/\bitau\b/.test(name(b.name))))?.id || '';
}
export function shiftWeeklyDate(original: string, edited: string, requested: string) {
 const days=Math.round((Date.parse(`${requested}T12:00:00Z`)-Date.parse(`${edited}T12:00:00Z`))/86400000);
 return addDays(original,days);
}
