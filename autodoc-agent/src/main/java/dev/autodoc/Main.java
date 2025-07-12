package dev.autodoc;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import dev.autodoc.model.ClassSummary;
import dev.autodoc.parser.CodebaseParser;

import java.io.FileInputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Properties;

public class Main {
    public static void main(String[] args) throws Exception {
        Properties config = new Properties();
        config.load(new FileInputStream("src/main/resources/config.properties"));

        String codePath = config.getProperty("code.path");
        String outputPath = config.getProperty("output.path");

        CodebaseParser parser = new CodebaseParser();
        List<ClassSummary> summaries = parser.parseCodebase(codePath);

        Gson gson = new GsonBuilder().setPrettyPrinting().create();
        String jsonOutput = gson.toJson(summaries);

        Files.writeString(Path.of(outputPath, "classes-summary.json"), jsonOutput);
        System.out.println("✅ Parsed class metadata written to classes-summary.json");
    }
}
