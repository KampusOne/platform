import { Fragment, type ReactNode } from "react";
import { Platform, Text, View } from "react-native";
import { useAppearance } from "@/src/lib/appearance";
/** Deliberately no HTML, embedded media, or clickable model-generated URLs. */
export function StudyAnswer({value}:{value:string}){
  const {theme}=useAppearance();const base={fontFamily:theme.font.body,color:theme.text,fontSize:16,lineHeight:27};
  const inline=(line:string):ReactNode[]=>line.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((part,index)=>part.startsWith("**")&&part.endsWith("**")?<Text key={index} style={{fontFamily:theme.font.semibold}}>{part.slice(2,-2)}</Text>:part.startsWith("`")&&part.endsWith("`")?<Text key={index} style={{fontFamily:Platform.OS==="ios"?"Menlo":"monospace",fontSize:14,backgroundColor:theme.surfaceMuted}}>{part.slice(1,-1)}</Text>:<Fragment key={index}>{part}</Fragment>);
  const blocks:ReactNode[]=[];let code:string[]|null=null;
  for(const [index,line] of value.split("\n").entries()){
    if(line.startsWith("```")){if(code){blocks.push(<View key={`code${index}`} style={{padding:14,backgroundColor:theme.surfaceMuted,borderRadius:10,marginVertical:10}}><Text selectable style={{...base,fontFamily:Platform.OS==="ios"?"Menlo":"monospace",fontSize:13,lineHeight:21}}>{code.join("\n")}</Text></View>);code=null;}else code=[];continue;}
    if(code){code.push(line);continue;}if(!line.trim()){blocks.push(<View key={index} style={{height:9}}/>);continue;}
    const heading=line.match(/^(#{1,3})\s+(.+)$/);const list=line.match(/^\s*(?:[-*•]|(\d+)\.)\s+(.+)$/);
    if(heading){blocks.push(<Text key={index} selectable style={{...base,fontFamily:theme.font.semibold,fontSize:heading[1]?.length===1?21:18,lineHeight:29,marginTop:12,marginBottom:6}}>{inline(heading[2]??"")}</Text>);continue;}
    if(list){blocks.push(<View key={index} style={{flexDirection:"row",gap:10,marginVertical:3}}><Text style={{...base,color:theme.brand,minWidth:17}}>{list[1]?`${list[1]}.`:"•"}</Text><Text selectable style={{...base,flex:1}}>{inline(list[2]??"")}</Text></View>);continue;}
    blocks.push(<Text key={index} selectable style={base}>{inline(line)}</Text>);
  }
  if(code)blocks.push(<Text key="unfinished-code" selectable style={base}>{code.join("\n")}</Text>);
  return <View>{blocks}</View>;
}
