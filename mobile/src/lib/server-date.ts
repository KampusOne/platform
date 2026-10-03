/** PostgreSQL timestamps can contain a space and a short UTC offset, which Hermes rejects. */
export function serverDate(value:string|null|undefined):Date|null{
 if(!value)return null;
 const normalized=value.trim().replace(/^(\d{4}-\d{2}-\d{2})\s+/,'$1T').replace(/([+-]\d{2})$/,'$1:00');
 const date=new Date(normalized);
 return Number.isFinite(date.getTime())?date:null;
}
