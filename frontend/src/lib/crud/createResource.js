import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useToast } from "../../components/Toast.jsx";
import { api } from "./api.js";

/**
 * createResource("events", { singular: "Event" }) gives you, for a REST resource under /api/<name>:
 *   plain calls:  list, get, create, update, remove
 *   hooks:        useList(params), useOne(id), useCreate(), useUpdate(), useRemove()
 * Hooks own the cache keys, invalidate after every write, and show a toast on success or failure.
 * Errors that carry field messages are left to the form, so they do not also toast.
 */
export function createResource(name, { singular = name.replace(/s$/, ""), path = `/${name}`, slash = true } = {}) {
  const label = singular.charAt(0).toUpperCase() + singular.slice(1);
  const keys = {
    all: [name],
    list: (params) => [name, "list", params || {}],
    one: (id) => [name, "one", String(id)],
  };

  // The generated API routes end in a slash. Hand written ones, such as /me/registrations, do not.
  const collection = slash ? `${path}/` : path;

  const calls = {
    list: (params, options) => api(collection, { params, ...options }),
    get: (id, options) => api(`${path}/${id}`, options),
    create: (body) => api(collection, { method: "POST", body }),
    update: (id, body) => api(`${path}/${id}`, { method: "PATCH", body }),
    remove: (id) => api(`${path}/${id}`, { method: "DELETE" }),
  };

  function useList(params, options = {}) {
    return useQuery({
      queryKey: keys.list(params),
      queryFn: ({ signal }) => calls.list(params, { signal }),
      placeholderData: keepPreviousData,
      ...options,
    });
  }

  function useOne(id, options = {}) {
    return useQuery({
      queryKey: keys.one(id),
      queryFn: ({ signal }) => calls.get(id, { signal }),
      enabled: id !== undefined && id !== null && id !== "",
      ...options,
    });
  }

  function useWrite(fn, successMessage) {
    const client = useQueryClient();
    const toast = useToast();
    return useMutation({
      mutationFn: fn,
      onSuccess: () => {
        client.invalidateQueries({ queryKey: keys.all });
        if (successMessage) toast.success(successMessage);
      },
      onError: (error) => {
        if (!error?.fields) toast.error(error?.message || "Something went wrong. Try again.");
      },
    });
  }

  const useCreate = ({ message = `${label} created` } = {}) => useWrite(calls.create, message);
  const useUpdate = ({ message = `${label} saved` } = {}) => useWrite(({ id, ...body }) => calls.update(id, body), message);
  function useRemove({ message = `${label} deleted` } = {}) {
    const client = useQueryClient();
    const toast = useToast();
    return useMutation({
      mutationFn: calls.remove,
      onSuccess: (_, id) => {
        // Drop the deleted item first, so nothing tries to refetch it and gets a 404.
        client.removeQueries({ queryKey: keys.one(id) });
        client.invalidateQueries({ queryKey: keys.all });
        if (message) toast.success(message);
      },
      onError: (error) => toast.error(error?.message || "Something went wrong. Try again."),
    });
  }

  return { name, path, keys, ...calls, useList, useOne, useCreate, useUpdate, useRemove };
}
