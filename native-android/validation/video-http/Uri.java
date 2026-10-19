package android.net;

/** JVM fixture for the URI operations used by this check. Samsung uses Android's real Uri. */
public final class Uri {
    public static final Uri EMPTY = Uri.parse("");
    private final java.net.URI value;
    private Uri(String text) { value = java.net.URI.create(text); }
    public static Uri parse(String text) { return new Uri(text); }
    public String getScheme() { return value.getScheme(); }
    public String getHost() { return value.getHost(); }
    public int getPort() { return value.getPort(); }
    public String getUserInfo() { return value.getUserInfo(); }
    public String getFragment() { return value.getFragment(); }
    public String getPath() { return value.getPath(); }
    public String getEncodedQuery() { return value.getRawQuery(); }
    public Builder buildUpon() { return new Builder(value.toString()); }
    public String toString() { return value.toString(); }
    public boolean equals(Object other) { return other instanceof Uri && value.equals(((Uri) other).value); }
    public int hashCode() { return value.hashCode(); }
    public static final class Builder {
        private final String text;
        private boolean clear;
        public Builder(String text) { this.text = text; }
        public Builder clearQuery() { clear = true; return this; }
        public Uri build() { return Uri.parse(clear ? text.split("\\?", 2)[0] : text); }
    }
}
