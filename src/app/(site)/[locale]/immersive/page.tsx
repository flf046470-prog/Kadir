import type { Metadata } from "next";
import ImmersiveQuick from "@/components/immersive/quick-tour";
import { getPageContext } from "@/lib/page";
export const metadata: Metadata={title:"SkySphere — 3D, AR & VR concept tour",description:"Walk through an illustrative SkySphere architectural model in 3D, AR or VR."};
export default async function Page({params}:{params:Promise<{locale:string}>}){
  const {locale}=await getPageContext(params);
  return <ImmersiveQuick locale={locale}/>;
}
