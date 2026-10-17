package android.os

// Android runtime's mutableState implementation also implements Parcelable.
// These interfaces only permit JVM class loading. Snapshot observation remains
// the actual cached Compose implementation; parceling is never invoked here.
interface Parcelable {
    fun describeContents(): Int
    fun writeToParcel(destination: Parcel, flags: Int)
    interface Creator<T> {
        fun createFromParcel(source: Parcel): T
        fun newArray(size: Int): Array<T?>
    }
    interface ClassLoaderCreator<T> : Creator<T> {
        fun createFromParcel(source: Parcel, loader: ClassLoader?): T
    }
}
class Parcel { init { error("Parcel serialization is outside this snapshot-only test") } }

// The real Compose Thread.android implementation explicitly catches SDK-stub
// getMainLooper() failures and selects its host-test fallback MainThreadId=-1.
class Looper private constructor() {
    val thread: Thread get() = error("No Android Looper in this host test")
    companion object {
        @JvmStatic fun getMainLooper(): Looper = throw UnsupportedOperationException("Host test")
    }
}
