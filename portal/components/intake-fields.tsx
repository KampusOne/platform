"use client";
import {useState} from 'react';
export function PhoneField({id,label,value,error,onChange}:{id:string;label:string;value:string;error?:string|undefined;onChange:(value:string)=>void}){
 const countries=[['+234','🇳🇬 Nigeria'],['+233','🇬🇭 Ghana'],['+229','🇧🇯 Benin'],['+237','🇨🇲 Cameroon'],['+44','🇬🇧 UK'],['+1','🇺🇸 USA/Canada']];const country=countries.find(([prefix])=>value.startsWith(prefix!))?.[0]??'+234';
 const national=value.startsWith(country)?value.slice(country.length):value.replace(/^0/,'');
 return <label htmlFor={id}>{label}<span className="phone-input"><select aria-label={`${label} country code`} value={country} onChange={e=>onChange(e.target.value+national)}>{countries.map(([prefix,name])=><option key={prefix} value={prefix}>{name} {prefix}</option>)}</select><input id={id} type="tel" inputMode="tel" autoComplete="tel-national" value={national} placeholder={country==='+234'?'801 234 5678':'Phone number'} maxLength={14} aria-invalid={Boolean(error)} onChange={e=>onChange(country+e.target.value.replace(/\D/g,'').replace(/^0/,''))}/></span>{error?<span className="field-error" role="alert">{error}</span>:null}</label>;
}
export function BirthDateField({value,onChange,error,minAge=16}:{value:string;onChange:(value:string)=>void;error?:string|undefined;minAge?:number}){
 const [draftParts,setParts]=useState(value.split('-'));const parts=/^\d{4}-\d{2}-\d{2}$/.test(value)?value.split('-'):draftParts;
 const change=(index:number,next:string)=>{const result=[...parts];result[index]=next;setParts(result);onChange(result[0]&&result[1]&&result[2]?result.join('-'):'');};const year=new Date().getFullYear();
 return <fieldset className="date-fields"><legend>Date of birth</legend><div>{[[2,'Day',Array.from({length:31},(_,i)=>String(i+1).padStart(2,'0'))],[1,'Month',Array.from({length:12},(_,i)=>String(i+1).padStart(2,'0'))],[0,'Year',Array.from({length:111-minAge},(_,i)=>String(year-minAge-i))]].map(([index,label,options])=><select key={String(label)} aria-label={`Birth ${label}`} value={parts[Number(index)]??''} onChange={e=>change(Number(index),e.target.value)} required><option value="">{String(label)}</option>{(options as string[]).map(option=><option key={option} value={option}>{option}</option>)}</select>)}</div>{error?<span className="field-error" role="alert">{error}</span>:null}</fieldset>;
}
