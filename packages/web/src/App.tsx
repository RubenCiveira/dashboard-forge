import { Router, Route } from "@solidjs/router";
import { lazy } from "solid-js";
import Layout from "./components/Layout.js";

const Dashboard    = lazy(() => import("./pages/Dashboard.js"));
const Agents       = lazy(() => import("./pages/Agents.js"));
const Skills       = lazy(() => import("./pages/Skills.js"));
const Playbooks    = lazy(() => import("./pages/Playbooks.js"));
const Ollama       = lazy(() => import("./pages/Ollama.js"));
const Runners      = lazy(() => import("./pages/Runners.js"));
const ProjectBoard = lazy(() => import("./pages/ProjectBoard.js"));
const MCPs         = lazy(() => import("./pages/MCPs.js"));

export default function App() {
  return (
    <Router root={Layout}>
      <Route path="/"               component={Dashboard} />
      <Route path="/agents"         component={Agents} />
      <Route path="/skills"         component={Skills} />
      <Route path="/playbooks"      component={Playbooks} />
      <Route path="/ollama"         component={Ollama} />
      <Route path="/runners"        component={Runners} />
      <Route path="/mcps"           component={MCPs} />
      <Route path="/projects/:id"   component={ProjectBoard} />
    </Router>
  );
}
