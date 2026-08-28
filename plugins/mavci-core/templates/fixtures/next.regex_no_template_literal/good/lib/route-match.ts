const slug = "a"
const ESC = /[.*+?^${}()|[\]\\]/g
export const re = new RegExp("^/" + slug.replace(ESC, "\\$&") + "/(.*)$")
