import 'react-native';

declare module 'react-native' {
  interface FlatListProps<ItemT> {
    /** React Native 0.86 implements and declares this in FlatList.js (Flow),
     * but omits it from FlatList.d.ts. The native renderer regression exercises
     * the installed implementation so this stays tied to supported behavior. */
    strictMode?: boolean;
  }
}
