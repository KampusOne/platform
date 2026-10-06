import { useEffect, useRef, useState } from "react";
import { randomUUID } from 'expo-crypto';
import { Ionicons } from '@expo/vector-icons';
import { nairaToKobo } from '@/src/lib/money-input';
import { router, useLocalSearchParams } from "expo-router";
import { Image, Pressable, Text, View } from "react-native";
import { ToolPage, ToolButton, ToolField } from "@/src/components/toolkit";
import { useToast } from "@/src/components/toast";
import { useAppearance } from "@/src/lib/appearance";
import { api } from "@/src/lib/api";
import { pickAndUpload } from "@/src/lib/uploads";
export default function CreateListing() {
  const { role } = useLocalSearchParams<{ role: string }>();
  const tutor = role === "TUTOR";
  const { theme } = useAppearance();
  const toast = useToast();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [price, setPrice] = useState("");
  const [packageDays,setPackageDays]=useState("");
  const [stock, setStock] = useState("1");
  const [code, setCode] = useState("");
  const [location, setLocation] = useState("");
  const [image, setImage] = useState("");
  const [images,setImages]=useState<string[]>([]);
  const requestId=useRef(randomUUID());
  const [pricePreview,setPricePreview]=useState<{ready:boolean;baseKobo:number;platformKobo:number;processingEstimateKobo:number;customerEstimateKobo:number;sellerCommissionKobo:number}|null>(null);
  useEffect(()=>{
    if(tutor||!price.trim()){setPricePreview(null);return;}
    let valid=true,amount:number;try{amount=nairaToKobo(price);}catch{setPricePreview(null);return;}
    const timer=setTimeout(()=>void api<typeof pricePreview>('/v1/agents/products/price-preview?priceKobo='+amount).then(r=>{if(valid)setPricePreview(r);}).catch(()=>{if(valid)setPricePreview(null);}),300);
    return()=>{valid=false;clearTimeout(timer);};
  },[price,tutor]);
  const [categories, setCategories] = useState<{ id: string; name: string }[]>(
    [],
  );
  const [category, setCategory] = useState("");
  useEffect(()=>{requestId.current=randomUUID();},[name,description,price,stock,category,images]);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!tutor)
      void api<{ categories: typeof categories }>(
        "/v1/agents/product-categories",
      )
        .then((r) => setCategories(r.categories))
        .catch((e) => toast(e.message, "error"));
  }, [tutor, toast]);
  async function upload() {
    setBusy(true);
    try {
      const file = await pickAndUpload("product");
      if (file) {setImage(current=>current||file.url);setImages(current=>[...current,file.url].slice(0,6));}
    } catch (e) {
      toast(e instanceof Error ? e.message : "Upload failed", "error");
    } finally {
      setBusy(false);
    }
  }
  async function save() {
    setBusy(true);
    try {
      const path = tutor ? "/v1/agents/tutorials" : "/v1/agents/products";
      const body = tutor
        ? {
            packageDays:packageDays?Number(packageDays):null,
            courseCode: code,
            title: name,
            description,
            format: "IN_PERSON",
            priceKobo: nairaToKobo(price),
            capacity: Number(stock),
            locationText: location,
          }
        : {
            name,
            description,
            category: categories.find((c) => c.id === category)?.name,
            categoryId: category,
            priceKobo: nairaToKobo(price),
            stockQuantity: Number(stock),
            imageUrl: image || null,
            imageUrls:images,
            requestId:requestId.current,
          };
      const created = await api<{ id: string }>(path, {
        method: "POST",
        body: JSON.stringify(body),
      });
      if(tutor)await api(path + "/" + created.id + "/status", {
        method: "PATCH",
        body: JSON.stringify({ status: "SUBMITTED" }),
      });
      toast(tutor?"Submitted for review":"Product uploaded", "success");
      router.back();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not save listing", "error");
    } finally {
      setBusy(false);
    }
  }
  return (
    <ToolPage title={tutor ? "Create tutorial" : "Add product"}>
      {!tutor ? (
        <>
          <View style={{padding:18,borderRadius:22,backgroundColor:theme.surfaceTint,gap:8,marginBottom:20}}><Text style={{fontFamily:theme.font.displayStrong,fontSize:24,color:theme.text}}>Ready for your next sale</Text><Text style={{fontFamily:theme.font.body,lineHeight:22,color:theme.textMuted}}>Add clear photos and a price. Your product goes live when you upload it.</Text></View>
          <View style={{flexDirection:'row',flexWrap:'wrap',gap:12,marginBottom:18}}>
            {images.map((url,index)=><View key={url} style={{width:'47%',aspectRatio:1,borderRadius:18,overflow:'hidden'}}><Image source={{uri:url}} style={{width:'100%',height:'100%'}}/><Pressable accessibilityRole="button" accessibilityLabel={`Remove photo ${index+1}`} onPress={()=>{const next=images.filter((_,i)=>i!==index);setImages(next);setImage(next[0]??'');}} style={{position:'absolute',right:8,top:8,padding:8,borderRadius:30,backgroundColor:theme.canvas}}><Ionicons name="close" size={18} color={theme.text}/></Pressable></View>)}
            {images.length<6?<Pressable accessibilityRole="button" accessibilityLabel="Add product photo" disabled={busy} onPress={()=>void upload()} style={{width:'47%',aspectRatio:1,borderRadius:18,borderWidth:1,borderStyle:'dashed',borderColor:theme.deepBrand,alignItems:'center',justifyContent:'center',gap:8,backgroundColor:theme.surface}}><Ionicons name="camera-outline" size={28} color={theme.deepBrand}/><Text style={{fontFamily:theme.font.semibold,color:theme.deepBrand}}>{busy?'Uploading…':'Add photo'}</Text></Pressable>:null}
          </View>
        </>
      ) : null}
      <ToolField
        label={tutor ? "Tutorial title" : "Product name"}
        value={name}
        onChangeText={setName}
        maxLength={160}
      />
      <ToolField
        label="Description"
        value={description}
        onChangeText={setDescription}
        multiline
        maxLength={2000}
      />
      <ToolField
        label="Price (₦)"
        value={price}
        onChangeText={setPrice}
        keyboardType="decimal-pad"
      />
      <ToolField
        label={tutor ? "Available places" : "Stock quantity"}
        value={stock}
        onChangeText={setStock}
        keyboardType="number-pad"
      />
      {tutor ? (
        <>
          <ToolField label="Package access (days, optional)" value={packageDays} onChangeText={setPackageDays} keyboardType="number-pad"/>
          <Text style={{color:theme.textMuted}}>Leave blank for a scheduled session. Packages start after payment and include tutor chat.</Text>
          <ToolField label="Course code" value={code} onChangeText={setCode} />
          <ToolField
            label="Location"
            value={location}
            onChangeText={setLocation}
          />
        </>
      ) : (
        <View
          style={{
            flexDirection: "row",
            flexWrap: "wrap",
            gap: 8,
            marginBottom: 16,
          }}
        >
          {categories.map((c) => (
            <Pressable
              accessibilityRole="radio"
              accessibilityState={{ selected: category === c.id }}
              key={c.id}
              onPress={() => setCategory(c.id)}
              style={{
                padding: 13,
                borderRadius: 10,
                backgroundColor: category === c.id ? theme.sand : theme.surface,
              }}
            >
              <Text style={{ color: theme.text }}>{c.name}</Text>
            </Pressable>
          ))}
        </View>
      )}
      {!tutor&&pricePreview?.ready?<View style={{padding:18,borderRadius:18,backgroundColor:theme.surface,borderColor:theme.border,borderWidth:1,gap:8,marginBottom:18}}><Text style={{fontFamily:theme.font.semibold,color:theme.text}}>Price preview</Text>{[['Your price',pricePreview.baseKobo],['Campus One fee',pricePreview.platformKobo],['Estimated Paystack fee',pricePreview.processingEstimateKobo],['Customer estimate',pricePreview.customerEstimateKobo]].map(([label,amount])=><View key={String(label)} style={{flexDirection:'row',justifyContent:'space-between'}}><Text style={{fontFamily:theme.font.body,color:theme.textMuted}}>{label}</Text><Text style={{fontFamily:theme.font.semibold,color:theme.text}}>₦{(Number(amount)/100).toLocaleString('en-NG',{maximumFractionDigits:2})}</Text></View>)}<Text style={{fontFamily:theme.font.body,fontSize:12,lineHeight:18,color:theme.textMuted}}>Paystack confirms its actual fee at checkout.</Text></View>:null}
      <ToolButton
        label={busy ? "Uploading…" : tutor?"Submit for review":"Upload product"}
        disabled={
          busy ||
          !name.trim() ||
          description.trim().length < 10 ||
          price === "" ||
          (!tutor && (!image || !category))
        }
        onPress={() => void save()}
      />
    </ToolPage>
  );
}
