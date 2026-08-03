import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { fetchPlayerInsight, type PlayerInsight } from "../api/playerInsight";

// `uuid: null` deshabilita la query (`enabled: false`). Uso: el
// PlayerDrawer sólo dispara la carga cuando el usuario abre un
// jugador concreto — nada de eager fetch al montar la lista.

export function usePlayerInsight(
  uuid: string | null,
): UseQueryResult<PlayerInsight, Error> {
  return useQuery<PlayerInsight, Error>({
    queryKey: ["player-insight", uuid],
    queryFn: () => fetchPlayerInsight(uuid!),
    enabled: uuid !== null,
  });
}
