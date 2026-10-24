import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useToast } from "../components/Toast.jsx";
import { api } from "../lib/crud/api.js";

/** Register or join the waitlist, and cancel. Both refresh every list that shows seats or registrations. */
function useRegistrationAction(method) {
  const client = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: (eventId) => api(`/events/${eventId}/register`, { method }),
    onSuccess: (result) => {
      client.invalidateQueries();
      toast.success(result.message);
    },
    onError: (error) => toast.error(error.message),
  });
}

export const useRegister = () => useRegistrationAction("POST");
export const useCancelRegistration = () => useRegistrationAction("DELETE");

export const useCategories = () =>
  useQuery({ queryKey: ["events", "categories"], queryFn: () => api("/events/categories"), staleTime: 5 * 60 * 1000 });

export const aiSearch = (query) => api("/ai/search", { method: "POST", body: { query } });
export const aiDraft = (notes) => api("/ai/draft-event", { method: "POST", body: { notes } });

/** Download a file the API returns (CSV) under a chosen name. */
export async function downloadFile(path, filename, params) {
  const blob = await api(path, { as: "blob", params });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
