const API_KEY = "your_openweathermap_api_key"; // Replace with your actual OpenWeatherMap API key
const BASE_URL = "https://api.openweathermap.org/data/2.5/forecast";

export async function getWeatherForecast(location: string, date: Date) {
  const response = await fetch(
    `${BASE_URL}?q=${location}&appid=${API_KEY}&units=metric`
  );
  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.message || "Failed to fetch weather data");
  }

  // Find the forecast closest to the specified date
  const targetDate = date.getTime();
  const forecast = data.list.find((entry: any) => {
    const forecastDate = new Date(entry.dt * 1000).getTime();
    return Math.abs(forecastDate - targetDate) < 3 * 60 * 60 * 1000; // 3-hour window
  });

  if (!forecast) {
    throw new Error("No forecast available for the specified date");
  }

  return {
    temperature: forecast.main.temp,
    description: forecast.weather[0].description,
    date: new Date(forecast.dt * 1000),
  };
}
