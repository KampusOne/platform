import {useState} from 'react';
import {Text,View} from 'react-native';
import {api} from '@/src/lib/api';
import {useAppearance} from '@/src/lib/appearance';
import {ToolButton,ToolField} from './toolkit';
export function DiscountCodeField({scope,disabled,onApply}:{scope:'STORE'|'TUTORIAL'|'MATERIAL';disabled?:boolean;onApply:(code:string)=>void}){
 const {theme}=useAppearance(),[code,setCode]=useState(''),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[failed,setFailed]=useState(false);
 async function apply(){setBusy(true);setMessage('');try{const result=await api<{code:string;percent:number}>('/v1/discounts/validate',{method:'POST',body:JSON.stringify({scope,code})});setFailed(false);setMessage(`${result.percent}% code applied. Review the updated total before paying.`);onApply(result.code);}catch(e){setFailed(true);setMessage(e instanceof Error?e.message:'This code could not be checked.');}finally{setBusy(false);}}
 return <View style={{gap:8}}><ToolField label="Discount code" value={code} autoCapitalize="characters" maxLength={32} editable={!disabled&&!busy} onChangeText={value=>{setCode(value);setMessage('');onApply('');}}/><ToolButton secondary label={busy?'Checking code…':'Apply code'} disabled={disabled||busy||code.trim().length<3} onPress={()=>void apply()}/>{message?<Text accessibilityRole={failed?'alert':'text'} style={{color:failed?theme.error:theme.brand,fontSize:13}}>{message}</Text>:null}</View>;
}
