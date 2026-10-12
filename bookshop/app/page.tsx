import { redirect } from "next/navigation";
import { MA_BOOK } from "@/lib/books/product";
export default function Home(){redirect(MA_BOOK.path);}
