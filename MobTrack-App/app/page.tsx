import Link from "next/link";

export default function Home() {
  return (
    <div className="min-h-screen bg-blue-600 flex flex-col items-center justify-center p-6 space-y-8">
      
      {/* Login Button */}
      <Link
        href="/login"
        className="w-full max-w-md bg-gray-200 text-black text-3xl font-bold py-16 text-center rounded-md shadow-xl hover:bg-gray-300 transition duration-200"
      >
        LOGIN
      </Link>

      {/* Create Account Button */}
      <Link
        href="/register"
        className="w-full max-w-md bg-gray-200 text-black text-3xl font-bold py-16 text-center rounded-md shadow-xl hover:bg-gray-300 transition duration-200"
      >
        NO ACCOUNT?<br />CREATE ONE
      </Link>

      {/* Track Button */}
      <Link
        href="/track"
        className="w-full max-w-md bg-white text-black text-3xl font-bold py-16 text-center rounded-md shadow-xl hover:bg-gray-100 transition duration-200"
      >
        TRACK
      </Link>

    </div>
  );
}