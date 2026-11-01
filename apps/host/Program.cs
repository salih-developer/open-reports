// Hosts the Open Reports designer as an ASP.NET Core SPA. The reporting engine stays the Node server (apps/server):
// its routes (ReverseProxy in appsettings.json) are forwarded to it, so the browser works against a single origin.
// In Development, SpaProxy starts the Node API and the Vite dev server and redirects the browser to the designer.
var builder = WebApplication.CreateBuilder(args);

builder.Services.AddReverseProxy().LoadFromConfig(builder.Configuration.GetSection("ReverseProxy"));

var app = builder.Build();

app.MapReverseProxy();

// wwwroot holds the built designer after `dotnet publish`; in Development the Vite server serves it instead.
if (Directory.Exists(app.Environment.WebRootPath))
{
    app.UseDefaultFiles();
    app.UseStaticFiles();
    app.MapFallbackToFile("index.html");
}

app.Run();
