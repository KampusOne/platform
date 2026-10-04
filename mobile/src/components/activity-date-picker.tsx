import {useState} from 'react';
import {Modal,Pressable,ScrollView,Text,View} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {Ionicons} from '@expo/vector-icons';
import {useAppearance} from '@/src/lib/appearance';
import {ToolButton} from './toolkit';
import {calendarDate,selectedActivityDate,selectedDateLabel,selectedTimeLabel} from '@/src/lib/campus-activity-date';

/** Dependency-free calendar and clock options shared by event/sports/deadline forms. */
export function ActivityDatePicker({label,value,onChange,disabled=false,mode='date'}:{label:string;value:string;onChange:(value:string)=>void;disabled?:boolean;mode?:'date'|'time'}){
 const {theme}=useAppearance();
 const [open,setOpen]=useState(false),[month,setMonth]=useState(()=>new Date()),[hour,setHour]=useState('10'),[minute,setMinute]=useState('00'),[period,setPeriod]=useState('AM'),[choosingYear,setChoosingYear]=useState(false);
 const text={fontFamily:theme.font.body,color:theme.text,fontSize:14};
 function show(){
  if(mode==='date'){const date=selectedActivityDate(value,'12:00')??new Date();setMonth(new Date(date.getFullYear(),date.getMonth(),1));}
  else {const match=/^(\d{2}):(\d{2})$/.exec(value);const selectedHour=match?Number(match[1]):10;setHour(String(selectedHour%12||12));setMinute(match?.[2]??'00');setPeriod(selectedHour<12?'AM':'PM');}
  setChoosingYear(false);setOpen(true);
 }
 const offset=new Date(month.getFullYear(),month.getMonth(),1).getDay(),days=new Date(month.getFullYear(),month.getMonth()+1,0).getDate();
 return <View style={{gap:8}}>
  <Text style={[text,{fontSize:12,color:theme.textMuted,fontFamily:theme.font.medium}]}>{label}</Text>
  <Pressable accessibilityRole="button" accessibilityLabel={`${label}: ${mode==='date'?selectedDateLabel(value):selectedTimeLabel(value)}`} accessibilityState={{disabled,expanded:open}} disabled={disabled} onPress={show} style={{minHeight:54,borderRadius:14,borderWidth:1,borderColor:theme.border,paddingHorizontal:14,flexDirection:'row',gap:10,alignItems:'center',backgroundColor:theme.surface}}>
   <Ionicons name={mode==='date'?'calendar-outline':'time-outline'} size={20} color={theme.deepBrand}/><Text style={[text,{flex:1}]}>{mode==='date'?selectedDateLabel(value):selectedTimeLabel(value)}</Text>
  </Pressable>
  <Modal visible={open} animationType="slide" presentationStyle="pageSheet" onRequestClose={()=>setOpen(false)}>
   <SafeAreaView style={{flex:1,backgroundColor:theme.canvas}}><ScrollView contentContainerStyle={{padding:20,gap:24}} keyboardShouldPersistTaps="handled">
    <View style={{flexDirection:'row',alignItems:'center'}}><Text style={[text,{flex:1,fontFamily:theme.font.displayStrong,fontSize:24}]}>{label}</Text><Pressable accessibilityRole="button" accessibilityLabel="Close date and time choices" onPress={()=>setOpen(false)} style={{minWidth:44,minHeight:44,alignItems:'center',justifyContent:'center'}}><Ionicons name="close" size={24} color={theme.text}/></Pressable></View>
    {mode==='date'?<>
     <View style={{flexDirection:'row',alignItems:'center',gap:12}}>
      <Pressable accessibilityRole="button" accessibilityLabel="Previous month" onPress={()=>setMonth(new Date(month.getFullYear(),month.getMonth()-1,1))} style={{minHeight:44,minWidth:44,alignItems:'center',justifyContent:'center'}}><Ionicons name="chevron-back" size={22} color={theme.deepBrand}/></Pressable>
      <Text accessibilityRole="header" style={[text,{flex:1,textAlign:'center',fontFamily:theme.font.semibold,fontSize:18}]}>{month.toLocaleDateString('en-NG',{month:'long',year:'numeric'})}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="Next month" onPress={()=>setMonth(new Date(month.getFullYear(),month.getMonth()+1,1))} style={{minHeight:44,minWidth:44,alignItems:'center',justifyContent:'center'}}><Ionicons name="chevron-forward" size={22} color={theme.deepBrand}/></Pressable>
     </View>
     <Pressable accessibilityRole="button" accessibilityLabel="Choose year" accessibilityState={{expanded:choosingYear}} onPress={()=>setChoosingYear(v=>!v)} style={{minHeight:44,flexDirection:'row',alignItems:'center',gap:8}}><Text style={[text,{color:theme.deepBrand}]}>Year · {month.getFullYear()}</Text><Ionicons name={choosingYear?'chevron-up':'chevron-down'} size={16} color={theme.deepBrand}/></Pressable>
     {choosingYear?<View style={{flexDirection:'row',flexWrap:'wrap',gap:6}}>{Array.from({length:13},(_,i)=>new Date().getFullYear()-1+i).map(year=><Pressable key={year} accessibilityRole="button" accessibilityState={{selected:year===month.getFullYear()}} onPress={()=>{setMonth(new Date(year,month.getMonth(),1));setChoosingYear(false);}} style={{minHeight:44,minWidth:64,padding:10,borderRadius:10,backgroundColor:year===month.getFullYear()?theme.surfaceTint:theme.surface}}><Text style={text}>{year}</Text></Pressable>)}</View>:null}
     <View style={{flexDirection:'row'}}>{['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(day=><Text key={day} style={[text,{width:'14.2857%',textAlign:'center',fontSize:12,color:theme.textMuted}]}>{day}</Text>)}</View>
     <View style={{flexDirection:'row',flexWrap:'wrap'}}>{Array.from({length:offset+days},(_,index)=>{const day=index-offset+1;if(day<1)return <View key={index} style={{width:'14.2857%',height:48}}/>;const chosen=calendarDate(new Date(month.getFullYear(),month.getMonth(),day)),selected=value===chosen;return <Pressable key={index} accessibilityRole="button" accessibilityLabel={selectedDateLabel(chosen)} accessibilityState={{selected}} onPress={()=>{onChange(chosen);setOpen(false);}} style={{width:'14.2857%',minHeight:48,alignItems:'center',justifyContent:'center',borderRadius:12,backgroundColor:selected?theme.deepBrand:undefined}}><Text style={[text,{fontFamily:theme.font.medium,color:selected?'#fff':theme.text}]}>{day}</Text></Pressable>;})}</View>
     <ToolButton secondary label="Today" onPress={()=>{onChange(calendarDate(new Date()));setOpen(false);}}/>
    </>:<>
     <Text style={[text,{color:theme.textMuted}]}>Choose the hour, minutes and AM or PM.</Text>
     <Text accessibilityLiveRegion="polite" style={[text,{fontFamily:theme.font.semibold,fontSize:22}]}>{hour}:{minute} {period}</Text>
     <View style={{flexDirection:'row',gap:12,height:300}}>{[{label:'Hour',value:hour,options:Array.from({length:12},(_,i)=>String(i+1)),change:setHour},{label:'Minutes',value:minute,options:Array.from({length:60},(_,i)=>String(i).padStart(2,'0')),change:setMinute},{label:'AM or PM',value:period,options:['AM','PM'],change:setPeriod}].map(column=><View key={column.label} style={{flex:1,gap:8}}><Text style={[text,{fontFamily:theme.font.medium,fontSize:12,color:theme.textMuted}]}>{column.label}</Text><ScrollView nestedScrollEnabled style={{borderWidth:1,borderColor:theme.border,borderRadius:12,backgroundColor:theme.surface}}>{column.options.map(option=><Pressable key={option} accessibilityRole="radio" accessibilityLabel={`${column.label}: ${option}`} accessibilityState={{selected:column.value===option}} onPress={()=>column.change(option)} style={{minHeight:48,padding:12,alignItems:'center',justifyContent:'center',backgroundColor:column.value===option?theme.surfaceTint:undefined}}><Text style={[text,{fontFamily:column.value===option?theme.font.semibold:theme.font.body,color:column.value===option?theme.deepBrand:theme.text}]}>{option}</Text></Pressable>)}</ScrollView></View>)}</View>
     <ToolButton label="Use this time" onPress={()=>{onChange(`${String(Number(hour)%12+(period==='PM'?12:0)).padStart(2,'0')}:${minute}`);setOpen(false);}}/>
    </>}
   </ScrollView></SafeAreaView>
  </Modal>
 </View>;
}
