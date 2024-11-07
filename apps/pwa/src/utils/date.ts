export function getLongFormattedDate(date: string) {
  try {
    return new Intl.DateTimeFormat("en-PH", {
      timeZone: "Asia/Manila",
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    }).format(new Date(date));
  } catch (err) {
    console.log("Unable to format date properly: ", err);
    return "";
  }
}

export function getFormattedTime(date: string) {
  try {
    return new Intl.DateTimeFormat("en-PH", {
      timeZone: "Asia/Manila",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    }).format(new Date(date));
  } catch (err) {
    console.log("Unable to format and get time properly: ", err);
    return "";
  }
}
