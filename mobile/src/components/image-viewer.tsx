import { Image, Modal, Platform, Pressable, ScrollView, Text, View } from "react-native";
import { downloadPostMedia } from "@/src/lib/media-downloads";
import { useToast } from "@/src/components/toast";
import { Ionicons } from "@expo/vector-icons";
import { SafeAreaView } from "react-native-safe-area-context";

export function ImageViewer({ uri, label, onClose, downloadable=false }: { uri: string | null; label: string; onClose(): void; downloadable?:boolean }) {
  const toast=useToast();
  return <Modal visible={Boolean(uri)} animationType="fade" onRequestClose={onClose} presentationStyle="fullScreen">
    <SafeAreaView style={{ flex: 1, backgroundColor: "#080808" }}>
      <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 10 }}><Pressable accessibilityRole="button" accessibilityLabel="Close photo" onPress={onClose} style={{ padding: 12 }}><Ionicons name="close" size={27} color="#FFFFFF" /></Pressable><Text style={{ color: "#FFFFFF", fontSize: 15 }}>{label}</Text></View>
      {downloadable && uri && Platform.OS==='android'?<Pressable accessibilityRole="button" onPress={()=>{void downloadPostMedia(uri).then(()=>{onClose();toast('Download started','success');}).catch(error=>toast(error.message,'error'));}} style={{minHeight:48,padding:14,flexDirection:'row',gap:10,alignItems:'center'}}><Ionicons name="download-outline" size={23} color="#FFFFFF"/><Text style={{color:'#FFFFFF'}}>Download photo</Text></Pressable>:null}
      <ScrollView contentContainerStyle={{ flexGrow: 1 }} maximumZoomScale={4} minimumZoomScale={1} centerContent>{uri ? <Image source={{ uri }} accessibilityLabel={label} resizeMode="contain" style={{ flex: 1, width: "100%", minHeight: 300 }} /> : null}</ScrollView>
    </SafeAreaView>
  </Modal>;
}
