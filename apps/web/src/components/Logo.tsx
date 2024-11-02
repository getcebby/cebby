import Image from "next/image";
import { app } from "@/config/app";
import Link from "next/link";
import SparklesText from "./SparkleText";

const ImageLogo = () => {
  return (
    <div className="flex items-center justify-center w-full h-full">
      <Image
        src="/logo.svg"
        alt={app.title}
        className="object-contain dark:invert"
        width={80}
        height={28}
        priority
      />
    </div>
  );
};

export const Logo = () => {
  return (
    <div className="relative h-7">
      <Link href="/" className="block h-full">
        <SparklesText as={<ImageLogo />} text={app.title} />
      </Link>
      <span className="sr-only">{app.description}</span>
    </div>
  );
};

export default Logo;
