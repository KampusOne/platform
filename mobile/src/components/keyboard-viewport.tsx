import { createContext, forwardRef, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Keyboard, Modal, Platform, ScrollView, StyleSheet, TextInput, View, type ModalProps, type ScrollViewProps, type ViewProps } from 'react-native';
import { keyboardOverlap } from '@/src/lib/keyboard-layout';
const KeyboardViewportContext = createContext({ keyboardVisible: false, height: 0 });
export const useKeyboardViewport = () => useContext(KeyboardViewportContext);

/** Android edge-to-edge windows can overlay the IME despite adjustResize.
 * Measure this window, rather than subtracting the keyboard height twice. */
export function KeyboardViewport({ children, style, onLayout, ...props }: ViewProps) {
  const viewport = useRef<View>(null);
  const keyboardY = useRef<number | null>(null);
  const [overlap, setOverlap] = useState(0);
  const [height, setHeight] = useState(0);
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const pending = useRef<number | null>(null);
  const measure = useCallback(() => {
    if (Platform.OS !== 'android') return;
    viewport.current?.measureInWindow((_x, y, _width, height) => {
      setOverlap(keyboardOverlap(y, height, keyboardY.current));
      setHeight(height);
    });
  }, []);
  const schedule = useCallback(() => {
    if (pending.current !== null) cancelAnimationFrame(pending.current);
    pending.current = requestAnimationFrame(() => { pending.current = null; measure(); });
  }, [measure]);
  useEffect(() => {
    if (Platform.OS === 'web') return;
    keyboardY.current = Keyboard.metrics()?.screenY ?? null;
    setKeyboardVisible(Keyboard.isVisible());
    schedule();
    const show = Keyboard.addListener('keyboardDidShow', event => { keyboardY.current = event.endCoordinates.screenY; setKeyboardVisible(true); schedule(); });
    const hide = Keyboard.addListener('keyboardDidHide', () => { keyboardY.current = null; setKeyboardVisible(false); setOverlap(0); });
    return () => { show.remove(); hide.remove(); if (pending.current !== null) cancelAnimationFrame(pending.current); };
  }, [schedule]);
  return <View {...props} ref={viewport} collapsable={false} style={[styles.viewport, style, overlap > 0 && { paddingBottom: overlap }]} onLayout={event => { onLayout?.(event); schedule(); }}>
    <KeyboardViewportContext.Provider value={{ keyboardVisible, height: Math.max(0, height - overlap) }}><View style={styles.content}>{children}</View></KeyboardViewportContext.Provider>
  </View>;
}

/** A Modal owns a separate Android window; the navigator's inset cannot reach it. */
export function KeyboardModal({ children, onShow, ...props }: ModalProps) {
  return <Modal {...props} onShow={onShow}><KeyboardViewport>{children}</KeyboardViewport></Modal>;
}

/** Keep the focused field visible after the viewport changes, including long forms. */
export type KeyboardScrollView = ScrollView;
export const KeyboardScrollView = forwardRef<ScrollView, ScrollViewProps>(function KeyboardScrollView({ onFocus, onBlur, keyboardShouldPersistTaps = 'handled', ...props }, forwardedRef) {
  const scroll = useRef<ScrollView>(null);
  const focused = useRef(false);
  const frame = useRef<number | null>(null);
  const { keyboardVisible, height } = useKeyboardViewport();
  const reveal = useCallback(() => {
    if (!focused.current || Platform.OS === 'web') return;
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      const input = TextInput.State.currentlyFocusedInput();
      if (focused.current && input) scroll.current?.scrollResponderScrollNativeHandleToKeyboard(input, 16, true);
    });
  }, []);
  useEffect(() => { if (keyboardVisible) reveal(); }, [keyboardVisible, height, reveal]);
  useEffect(() => () => { if (frame.current !== null) cancelAnimationFrame(frame.current); }, []);
  return <ScrollView {...props} keyboardShouldPersistTaps={keyboardShouldPersistTaps} ref={node => {
    scroll.current = node;
    if (typeof forwardedRef === 'function') forwardedRef(node); else if (forwardedRef) forwardedRef.current = node;
  }} onFocus={event => { focused.current = true; onFocus?.(event); reveal(); }} onBlur={event => { focused.current = false; onBlur?.(event); }} />;
});
const styles = StyleSheet.create({ viewport: { flex: 1, minHeight: 0 }, content: { flex: 1, minHeight: 0 } });
