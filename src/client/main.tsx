import { createRoot } from "react-dom/client"

import { Join, Landing } from "./Landing"
import { Ward } from "./Ward"
import "./styles.css"

function Router() {
    const [, page, code] = location.pathname.split("/")
    if (page === "join" && code) return <Join code={code.toUpperCase()} />
    if ((page === "room" || page === "host") && code) return <Ward code={code.toUpperCase()} />
    return <Landing />
}

createRoot(document.getElementById("root")!).render(<Router />)
