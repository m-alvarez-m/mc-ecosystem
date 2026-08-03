import { QueryClient } from "@tanstack/react-query";

// QueryClient global. Defaults conservadores para D1:
//
// - staleTime 60s: cache "fresco" durante 1 min → sin refetch al
//   remontar componentes o al reenfocar la ventana en ese lapso.
// - refetchOnWindowFocus true (default): cuando el usuario vuelve al
//   tab, revalida en background. Coste bajo, gana frescura.
// - retry 1: la API es interna y estable; reintentos multiples solo
//   añaden latencia percibida al fallo.
//
// El scope es toda la app: se pasa a QueryClientProvider en main.tsx.

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      retry: 1,
    },
  },
});
