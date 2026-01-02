import { createRouter } from "@tanstack/react-router";

// Import the generated route tree
import { routeTree } from "./routeTree.gen";

// Create a new router instance
export const getRouter = () => {
  const router = createRouter({
    routeTree,
    context: {},
    defaultNotFoundComponent: (props) => <div>Not Found {JSON.stringify(props)}</div>,
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
  });

  return router;
};
