package dev.autodoc.parser;

import com.github.javaparser.StaticJavaParser;
import com.github.javaparser.ast.CompilationUnit;
import com.github.javaparser.ast.body.*;
import com.github.javaparser.ast.expr.AnnotationExpr;
import com.github.javaparser.ast.type.Type;
import dev.autodoc.model.ClassSummary;

import java.io.File;
import java.io.IOException;
import java.nio.file.*;
import java.util.*;

public class CodebaseParser {

    public List<ClassSummary> parseCodebase(String rootPath) throws IOException {
        List<ClassSummary> summaries = new ArrayList<>();

        Files.walk(Paths.get(rootPath))
                .filter(path -> path.toString().endsWith(".java"))
                .forEach(path -> {
                    try {
                        CompilationUnit cu = StaticJavaParser.parse(path);
                        cu.findAll(ClassOrInterfaceDeclaration.class).forEach(cls -> {
                            ClassSummary summary = new ClassSummary();
                            summary.className = cls.getNameAsString();

                            // Class-level annotations
                            for (AnnotationExpr annotation : cls.getAnnotations()) {
                                String ann = annotation.getNameAsString();
                                summary.annotations.add(ann);
                                if (ann.equals("RestController"))
                                    summary.isRestController = true;
                                if (ann.equals("Entity"))
                                    summary.isEntity = true;
                            }

                            // Fields
                            for (FieldDeclaration field : cls.getFields()) {
                                Type type = field.getElementType();
                                for (VariableDeclarator v : field.getVariables()) {
                                    summary.fields.add(v.getNameAsString() + " : " + type.toString());
                                }
                            }

                            // Methods and Endpoint info
                            for (MethodDeclaration method : cls.getMethods()) {
                                summary.methods.add(method.getDeclarationAsString());

                                for (AnnotationExpr annotation : method.getAnnotations()) {
                                    String ann = annotation.getNameAsString();
                                    if (ann.matches("GetMapping|PostMapping|PutMapping|DeleteMapping|RequestMapping")) {
                                        summary.endpoints.add(ann + " -> " + method.getNameAsString());
                                    }
                                }
                            }

                            summaries.add(summary);
                        });
                    } catch (Exception e) {
                        System.err.println("Failed to parse " + path + ": " + e.getMessage());
                    }
                });

        return summaries;
    }
}
