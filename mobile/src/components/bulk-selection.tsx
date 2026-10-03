import { useState } from "react";
import { Modal, Pressable, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useAppearance } from "@/src/lib/appearance";

export function useBulkSelection(ids: string[], remove: (ids: string[]) => Promise<void>, noun: string) {
  const [active, setActive] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const valid = selected.filter(id => ids.includes(id));
  function cancel() { if (!busy) { setActive(false); setSelected([]); setConfirm(false); setError(""); } }
  return { active, selected: valid, confirm, busy, error, noun,
    open() { setActive(true); setError(""); }, cancel,
    toggle(id: string) { if (!busy) setSelected(rows => rows.includes(id) ? rows.filter(row => row !== id) : [...rows, id]); },
    selectAll() { if (!busy) setSelected(valid.length === ids.length ? [] : ids); },
    requestDelete() { if (valid.length) setConfirm(true); },
    dismissConfirm() { if (!busy) setConfirm(false); },
    async deleteSelected() { if (!valid.length || busy) return; setBusy(true); setError(""); try { await remove(valid); setActive(false); setSelected([]); setConfirm(false); } catch (e) { setError(e instanceof Error ? e.message : "Could not remove these records. Try again."); } finally { setBusy(false); } },
  };
}
export type BulkSelectionState = ReturnType<typeof useBulkSelection>;
export function BulkMenu({ selection }: { selection: BulkSelectionState }) {
  const { theme } = useAppearance();
  return <Pressable accessibilityRole="button" accessibilityLabel={selection.active ? "Cancel selection" : `Manage ${selection.noun}`} onPress={selection.active ? selection.cancel : selection.open} style={{ width:44,height:44,alignItems:"center",justifyContent:"center" }}><Ionicons name={selection.active ? "close-outline" : "ellipsis-horizontal"} size={23} color={theme.text} /></Pressable>;
}
export function SelectionCheckbox({ selection, id }: { selection: BulkSelectionState; id: string }) {
  const { theme } = useAppearance();
  if (!selection.active) return null;
  return <Pressable accessibilityRole="checkbox" accessibilityState={{ checked:selection.selected.includes(id), disabled:selection.busy }} accessibilityLabel={`Select ${selection.noun}`} disabled={selection.busy} onPress={() => selection.toggle(id)} style={{ minWidth:44,minHeight:44,alignItems:"center",justifyContent:"center" }}><Ionicons name={selection.selected.includes(id) ? "checkbox" : "square-outline"} size={23} color={theme.deepBrand} /></Pressable>;
}
export function BulkToolbar({ selection, count }: { selection: BulkSelectionState; count: number }) {
  const { theme } = useAppearance();
  const text = { fontFamily:theme.font.semibold, color:theme.text, fontSize:13 };
  if (!selection.active) return null;
  const button = (label:string,onPress:()=>void,disabled=false) => <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress} style={{minHeight:44,paddingHorizontal:12,justifyContent:"center",opacity:disabled ? 0.45 : 1}}><Text style={text}>{label}</Text></Pressable>;
  return <View style={{marginVertical:12,padding:8,borderRadius:14,backgroundColor:theme.surfaceMuted,borderWidth:1,borderColor:theme.border}}>
    <Text style={[text,{padding:8}]}>{selection.selected.length} of {count} selected</Text>
    <View style={{flexDirection:"row",flexWrap:"wrap",justifyContent:"space-between"}}>{button(selection.selected.length===count ? "Deselect all" : "Select all",selection.selectAll,selection.busy)}{button("Cancel",selection.cancel,selection.busy)}{button("Delete selected",selection.requestDelete,selection.busy||!selection.selected.length)}</View>
    <Modal visible={selection.confirm} transparent animationType="fade" onRequestClose={selection.dismissConfirm}>
      <View style={{flex:1,justifyContent:"center",padding:24,backgroundColor:"rgba(0,0,0,.45)"}}><View style={{backgroundColor:theme.surface,borderRadius:20,padding:22,gap:12,maxWidth:430,width:"100%",alignSelf:"center"}}>
        <Text style={{fontFamily:theme.font.displayStrong,color:theme.text,fontSize:21}}>Delete {selection.selected.length} {selection.noun}?</Text>
        <Text style={{fontFamily:theme.font.body,color:theme.textMuted,lineHeight:22}}>These records will be removed from your account. This cannot be undone.</Text>
        {selection.error ? <Text accessibilityRole="alert" style={{color:theme.error}}>{selection.error}</Text> : null}
        <View style={{flexDirection:"row",justifyContent:"flex-end"}}>{button("Keep records",selection.dismissConfirm,selection.busy)}{button(selection.busy ? "Deleting…" : "Delete",()=>void selection.deleteSelected(),selection.busy)}</View>
      </View></View>
    </Modal>
  </View>;
}
