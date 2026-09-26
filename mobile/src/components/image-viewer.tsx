import { Image, Modal, Pressable, ScrollView, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { SafeAreaView } from "react-native-safe-area-context";

export function ImageViewer({ uri, label, onClose }: { uri: string | null; label: string; onClose(): void }) {
  return <Modal visible={Boolean(uri)} animationType="fade" onRequestClose={onClose} presentationStyle="fullScreen">
    <SafeAreaView style={{ flex: 1, backgroundColor: "#080808" }}>
      <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 10 }}><Pressable accessibilityRole="button" accessibilityLabel="Close photo" onPress={onClose} style={{ padding: 12 }}><Ionicons name="close" size={27} color="#FFFFFF" /></Pressable><Text style={{ color: "#FFFFFF", fontSize: 15 }}>{label}</Text></View>
      <ScrollView contentContainerStyle={{ flexGrow: 1 }} maximumZoomScale={4} minimumZoomScale={1} centerContent>{uri ? <Image source={{ uri }} accessibilityLabel={label} resizeMode="contain" style={{ flex: 1, width: "100%", minHeight: 300 }} /> : null}</ScrollView>
    </SafeAreaView>
  </Modal>;
}
